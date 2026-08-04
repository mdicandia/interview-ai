/**
 * Drives a full interview session against the real voice server, with no browser.
 *
 * Cartesia synthesises the candidate's speech, that audio is streamed into the
 * server exactly as a microphone would, and the state transitions, transcript
 * and returned audio are asserted. Then it interrupts mid-reply to check
 * barge-in, which is the one behaviour that cannot be verified any other way.
 *
 * Run with: pnpm verify:server
 */

import { spawn, type ChildProcess } from 'node:child_process'
import WebSocket from 'ws'
import { createTtsClient, SAMPLE_RATE } from '../server/pipeline/tts'
import type { ClientMessage, ServerMessage, TurnState } from '../server/protocol'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

const PORT = 8799 // not the dev port, so this never fights a running server
let failures = 0

function check(ok: boolean, label: string, detail = '') {
  if (ok) console.log(`  ${GREEN}✓${RESET} ${label}${detail ? ` ${DIM}${detail}${RESET}` : ''}`)
  else {
    failures++
    console.log(`  ${RED}✗${RESET} ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Synthesises a sentence to raw PCM, to stand in for the microphone. */
async function speechFor(text: string): Promise<Buffer> {
  const chunks: Buffer[] = []
  let done = false
  const tts = await createTtsClient(process.env.CARTESIA_API_KEY ?? '', {
    onAudio: (pcm) => chunks.push(pcm),
    onDone: () => { done = true },
    onError: () => { done = true },
  })
  tts.speak(text, 'probe')
  tts.finish('probe')
  const deadline = Date.now() + 25_000
  while (!done && Date.now() < deadline) await sleep(40)
  tts.close()
  return Buffer.concat(chunks)
}

async function main() {
  console.log('\nStarting voice server')

  const child: ChildProcess = spawn(
    'node',
    ['--env-file=.env.local', '--import', 'tsx', 'server/index.ts'],
    { env: { ...process.env, VOICE_SERVER_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  child.stderr?.on('data', (d) => {
    const line = String(d).trim()
    if (line) console.log(`    ${DIM}[server] ${line}${RESET}`)
  })

  // Wait for the port to accept connections.
  let up = false
  const bootDeadline = Date.now() + 25_000
  while (!up && Date.now() < bootDeadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const probe = new WebSocket(`ws://localhost:${PORT}`)
        probe.once('open', () => { probe.close(); resolve() })
        probe.once('error', reject)
      })
      up = true
    } catch {
      await sleep(300)
    }
  }
  check(up, 'server accepts connections', `ws://localhost:${PORT}`)
  if (!up) {
    child.kill()
    process.exit(1)
  }

  console.log('\nFull session')

  const socket = new WebSocket(`ws://localhost:${PORT}`)
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })

  const states: TurnState[] = []
  const interviewerSaid: string[] = []
  const candidateFinals: string[] = []
  let audioBytes = 0
  let flushes = 0
  let ready = false
  let firstAudioAt: number | null = null
  let turnStartedAt = 0

  socket.on('message', (data, isBinary) => {
    if (isBinary) {
      audioBytes += (data as Buffer).length
      if (firstAudioAt === null && turnStartedAt > 0) firstAudioAt = Date.now() - turnStartedAt
      return
    }
    const message = JSON.parse(data.toString()) as ServerMessage
    switch (message.type) {
      case 'ready': ready = true; break
      case 'state': states.push(message.turn); break
      case 'flush-audio': flushes++; break
      case 'transcript':
        if (message.role === 'interviewer') interviewerSaid.push(message.text)
        else if (message.final) candidateFinals.push(message.text)
        break
      case 'error':
        check(false, 'server error', message.message)
        break
    }
  })

  const send = (message: ClientMessage) => socket.send(JSON.stringify(message))

  send({ type: 'start', problemSlug: 'flaky-retry', language: 'python' })
  const readyDeadline = Date.now() + 20_000
  while (!ready && Date.now() < readyDeadline) await sleep(100)
  check(ready, 'session starts')

  // Give the interviewer the editor contents, as the browser does on load.
  send({
    type: 'code',
    activePath: 'retry.py',
    files: [
      {
        path: 'retry.py',
        content:
          'import time\n\n\ndef retry(operation, max_attempts=3, base_delay=1.0, sleep=time.sleep):\n' +
          '    last_error = None\n    for attempt in range(max_attempts):\n        try:\n' +
          '            return operation()\n        except Exception as exc:\n' +
          '            last_error = exc\n            sleep(base_delay)\n    return None\n',
      },
    ],
  })

  /** Streams PCM in paced 20ms frames, as a live microphone would. */
  const FRAME = SAMPLE_RATE * 2 * 0.02
  async function speakAsCandidate(audio: Buffer, silenceFrames = 40) {
    for (let offset = 0; offset < audio.length; offset += FRAME) {
      socket.send(audio.subarray(offset, Math.min(offset + FRAME, audio.length)), { binary: true })
      await sleep(20)
    }
    const silence = Buffer.alloc(FRAME)
    for (let i = 0; i < silenceFrames; i++) {
      socket.send(silence, { binary: true })
      await sleep(20)
    }
  }

  const turn1 = await speechFor(
    'I can see the delays are not doubling, they stay the same on every attempt.',
  )
  check(turn1.length > 0, 'synthesised candidate speech', `${(turn1.length / (SAMPLE_RATE * 2)).toFixed(1)}s`)

  turnStartedAt = Date.now()
  await speakAsCandidate(turn1)

  // Let the model reply and the audio come back.
  const replyDeadline = Date.now() + 20_000
  while (interviewerSaid.length === 0 && Date.now() < replyDeadline) await sleep(100)
  await sleep(2500)

  check(candidateFinals.length > 0, 'transcribes the candidate', `"${candidateFinals.join(' ').slice(0, 60)}"`)
  check(states.includes('listening'), 'entered listening')
  check(states.includes('thinking'), 'entered thinking')
  check(states.includes('speaking'), 'entered speaking')
  check(interviewerSaid.length > 0, 'interviewer replies', `"${interviewerSaid.join(' ').slice(0, 70)}"`)
  check(audioBytes > 0, 'streams interviewer audio back', `${audioBytes} bytes`)
  check(
    firstAudioAt !== null && firstAudioAt < 12_000,
    'audio arrives within the turn',
    `${firstAudioAt}ms from start of candidate speech`,
  )

  console.log('\nBarge-in')

  // Both clips are synthesised up front. Generating the interruption *after*
  // detecting that the interviewer is speaking takes a Cartesia round trip of a
  // second or more, by which time the reply has often finished — and then there
  // is nothing to interrupt, so the test passes or fails for the wrong reason.
  const [longPrompt, interruption] = await Promise.all([
    speechFor('Can you explain in detail how exponential backoff works and why it helps?'),
    speechFor('Wait, sorry, let me stop you there.'),
  ])

  // Short trailing silence: enough for endpointing to fire, not so much that the
  // reply is over before we can cut in.
  await speakAsCandidate(longPrompt, 25)

  const speakDeadline = Date.now() + 15_000
  while (Date.now() < speakDeadline) {
    if (states[states.length - 1] === 'speaking') break
    await sleep(30)
  }
  check(states[states.length - 1] === 'speaking', 'interviewer is mid-reply before the interruption')

  const flushesBefore = flushes
  const audioBefore = audioBytes

  // Straight in, with no synthesis delay.
  await speakAsCandidate(interruption, 8)
  await sleep(1500)

  const audioAfterInterrupt = audioBytes - audioBefore
  check(flushes > flushesBefore, 'server tells the browser to flush buffered audio', `${flushes - flushesBefore} flush(es)`)
  check(
    states[states.length - 1] !== 'speaking',
    'leaves the speaking state',
    `state now "${states[states.length - 1]}", ${audioAfterInterrupt} bytes arrived after cut-in`,
  )

  send({ type: 'end' })
  await sleep(400)
  socket.close()
  child.kill()
  await sleep(300)

  console.log(
    failures === 0
      ? `\n${GREEN}Voice server verified end to end.${RESET}\n`
      : `\n${RED}${failures} check(s) failed.${RESET}\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

void main()
