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
  const observations: { note: string; axis: string; significance: string }[] = []
  let runTestsRequests = 0
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
      case 'run-tests': runTestsRequests++; break
      case 'observation':
        observations.push({
          note: message.note,
          axis: message.axis,
          significance: message.significance,
        })
        break
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

  console.log('\nTool use')

  /*
   * Two behaviours, driven by speech rather than asserted against a mock.
   *
   * The first is the whole point of `run_tests`: asking for the code to be run
   * has to actually run it. The server has no runtime, so all it can do is emit
   * the request — which is exactly what the browser acts on.
   */
  const saidBefore = interviewerSaid.length
  const askToRun = await speechFor("Okay, I think that's fixed now. Can you run the tests?")
  await speakAsCandidate(askToRun, 30)

  // Waits for the speech as well as the request. The model may call the tool
  // with no content at all, in which case a second generation produces the
  // words — checking the instant the request lands measures the gap, not the
  // behaviour.
  const runDeadline = Date.now() + 25_000
  while (
    (runTestsRequests === 0 || interviewerSaid.length === saidBefore) &&
    Date.now() < runDeadline
  ) {
    await sleep(100)
  }
  check(runTestsRequests > 0, 'interviewer asks for the tests to be run', `${runTestsRequests} request(s)`)
  check(
    interviewerSaid.length > saidBefore,
    'and says something while doing it',
    `"${interviewerSaid.slice(saidBefore).join(' ').slice(0, 70)}"`,
  )
  await sleep(1500)

  // Closing the loop: the browser reports what happened, and that has to start a
  // fresh spoken turn rather than vanishing.
  const beforeResults = interviewerSaid.length
  send({ type: 'test-results', passed: 5, total: 5, failing: [] })
  const reactDeadline = Date.now() + 20_000
  while (interviewerSaid.length === beforeResults && Date.now() < reactDeadline) await sleep(100)
  check(
    interviewerSaid.length > beforeResults,
    'reacts to the results coming back',
    `"${interviewerSaid.slice(beforeResults).join(' ').slice(0, 70)}"`,
  )
  await sleep(2000)

  /*
   * The second is `note_observation`. Driven by saying something confidently
   * wrong, which is squarely what the tool description asks it to flag — and,
   * critically, the note must not be spoken. A candidate who hears "I'm noting
   * that you got that wrong" is having a different experience entirely.
   */
  const beforeNote = interviewerSaid.length
  // Counted, not tested for emptiness: the interviewer may well have noted
  // something on an earlier turn, and `observations.length === 0` would then be
  // false the instant we start waiting — passing the check while measuring the
  // wrong turn, and cutting the settle short so the reply looks missing.
  const notesBefore = observations.length
  const wrongClaim = await speechFor(
    "Actually the real bug is that three attempts is too many, so I'm going to set max attempts to one and that will fix all of it.",
  )
  await speakAsCandidate(wrongClaim, 30)

  // A turn that takes a note is the slow shape: endpointing, then a generation
  // that returns only a tool call, then a second one to produce speech.
  const noteDeadline = Date.now() + 30_000
  while (
    (observations.length === notesBefore || interviewerSaid.length === beforeNote) &&
    Date.now() < noteDeadline
  ) {
    await sleep(100)
  }
  await sleep(2500)

  /*
   * Reported, not asserted.
   *
   * Whether the interviewer takes a note is its own judgement, and it varies:
   * measured across three runs of this script with an identical prompt, the
   * count went 1, then 0, then 0. Failing the build on that would be failing on
   * the model's mood, and the fix would be to keep tuning the prompt until one
   * run happened to pass — which proves nothing.
   *
   * The machinery that must never break is pinned deterministically instead, in
   * `verify:tools`. This line is here to keep the live rate visible, because a
   * long run of zeroes is worth knowing about even though one is not.
   */
  console.log(
    `  ${DIM}·${RESET} observations this run: ${observations.length}` +
      (observations.length > 0
        ? ` ${DIM}${observations.map((o) => `[${o.axis}/${o.significance}] ${o.note.slice(0, 50)}`).join(' | ')}${RESET}`
        : ` ${DIM}(discretionary — see verify:tools for the dispatch checks)${RESET}`),
  )

  /*
   * Scans everything said in the session, not just the last turn.
   *
   * This originally checked only the slice after the note, and that is how a
   * real bug got through: the interviewer spoke `[Note: the tests pass but the
   * code shown is the *unfixed* original — ...]` out loud on an earlier turn,
   * straight into the speech synthesiser, while this check looked at an empty
   * slice and passed. Anything the interviewer produces is heard.
   */
  const everythingSaid = interviewerSaid.join(' ')
  check(
    !/\[[^\]]*\]/.test(everythingSaid),
    'never speaks bracketed meta-text',
    everythingSaid.match(/\[[^\]]*\]/)?.[0] ?? '',
  )
  check(
    !/\b(note to self|noting that|i'?ll note|for the report|observation)\b/i.test(everythingSaid),
    'never says out loud that it took a note',
    everythingSaid.match(/\b(note to self|noting that|i'?ll note|for the report|observation)\b/i)?.[0] ?? '',
  )
  check(
    interviewerSaid.length > beforeNote,
    'answers the candidate after a claim worth challenging',
    `"${interviewerSaid.slice(beforeNote).join(' ').slice(0, 70)}"`,
  )

  console.log('\nBarge-in')

  // Both clips are synthesised up front. Generating the interruption *after*
  // detecting that the interviewer is speaking takes a Cartesia round trip of a
  // second or more, by which time the reply has often finished — and then there
  // is nothing to interrupt, so the test passes or fails for the wrong reason.
  //
  // Sequentially, not in parallel: the session's own TTS client holds one
  // Cartesia connection for the whole run, and the account allows two. Two
  // simultaneous `speechFor` calls make three, and the *server's* synthesis is
  // what gets rejected — which surfaces as the interviewer mysteriously going
  // silent rather than as an error in this script.
  // Three sub-questions on purpose. The interviewer is told to answer in one or
  // two sentences "unless explicitly asked to explain something", and a reply
  // that finishes in two seconds leaves nothing to interrupt — the test then
  // fails for want of a target rather than for want of barge-in.
  const longPrompt = await speechFor(
    'Can you explain in detail, step by step, how exponential backoff works, ' +
      'why it helps an upstream service that is already struggling, and what jitter adds to it?',
  )
  // Long enough for Deepgram's voice-activity detector to commit. A one-second
  // "Sorry, hold on." was tried and never raised SpeechStarted at all — the
  // shorter clip cuts in faster on paper and simply does not register.
  const interruption = await speechFor('Wait, sorry, let me stop you there for a second.')

  /*
   * Retried, because a missed attempt is not a failed barge-in.
   *
   * The interviewer is told to be brief, so a reply can be over in under two
   * seconds — less than it takes to stream the interruption in. When that
   * happens there is nothing to interrupt, and the old single-shot version
   * reported a barge-in failure when barge-in had never been exercised. Each
   * attempt now only counts if the reply was still going when we cut in.
   */
  let attempts = 0
  let interrupted = false
  let caughtSpeaking = false
  let detail = 'never caught the interviewer mid-reply'

  while (attempts < 3 && !interrupted) {
    attempts += 1

    /*
     * A full second of trailing silence, not half.
     *
     * `SpeechStarted` is a transition event: Deepgram raises it going from
     * silence into speech. With only 500ms after the question, the interruption
     * that follows can be folded into the same speech segment — no transition,
     * no event, no barge-in, and the flush never fires for a reason that has
     * nothing to do with the server.
     *
     * Waiting longer costs nothing here, because the cut-in is triggered by the
     * reply starting rather than by a timer.
     */
    await speakAsCandidate(longPrompt, 50)

    const speakDeadline = Date.now() + 15_000
    while (Date.now() < speakDeadline && states[states.length - 1] !== 'speaking') {
      await sleep(30)
    }
    if (states[states.length - 1] !== 'speaking') continue

    const flushesBefore = flushes
    const audioBefore = audioBytes
    const statesBefore = states.length

    // Straight in, with no synthesis delay.
    await speakAsCandidate(interruption, 8)
    console.log(
      `    ${DIM}attempt ${attempts}: states ${states.slice(statesBefore).join(' → ') || '(none)'}${RESET}`,
    )

    // Only a meaningful attempt if the reply had not already ended on its own.
    if (states[states.length - 1] === 'speaking' || flushes > flushesBefore) {
      caughtSpeaking = true
    }
    await sleep(1500)

    if (flushes > flushesBefore) {
      interrupted = true
      detail = `${flushes - flushesBefore} flush(es) on attempt ${attempts}, ${audioBytes - audioBefore} bytes after cut-in`
    } else if (caughtSpeaking) {
      detail = `caught it speaking on attempt ${attempts} but no flush followed`
    }
  }

  check(caughtSpeaking, 'interviewer is mid-reply before the interruption', `${attempts} attempt(s)`)
  check(interrupted, 'server tells the browser to flush buffered audio', detail)
  check(
    states[states.length - 1] !== 'speaking',
    'leaves the speaking state',
    `state now "${states[states.length - 1]}"`,
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
