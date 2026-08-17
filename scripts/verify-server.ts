/**
 * Drives a full interview session against the real voice server, with no browser.
 *
 * The local speech model synthesises the candidate's side, that audio is streamed
 * into the server exactly as a microphone would, and the state transitions,
 * transcript and returned audio are asserted. Then it interrupts mid-turn to
 * check barge-in, which is the one behaviour that cannot be verified any other
 * way.
 *
 * Everything except Deepgram and DeepSeek runs locally, so re-running this is
 * nearly free — which it needs to be, because the interesting failures here are
 * timing-dependent and you will run it many times.
 *
 * Run with: pnpm verify:server
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import WebSocket from 'ws'
import { SAMPLE_RATE } from '../server/pipeline/tts'
import { preloadKokoro } from '../server/pipeline/tts-kokoro'
import { AUDIO_SAMPLE_RATE, type ClientMessage, type ServerMessage, type TurnState } from '../server/protocol'

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

/*
 * The candidate's voice is synthesised locally and cached on disk.
 *
 * It used to come from Cartesia, and that drained a month's free tier during one
 * afternoon of chasing a flaky assertion in this very file — the same five fixed
 * sentences, re-synthesised and paid for on every retry, while nothing about
 * them changed. Now the whole suite costs nothing to run, which is the property
 * a test you re-run twenty times needs to have.
 *
 * A different voice from the interviewer's, so a transcript that mixes up who
 * said what is obvious rather than plausible.
 */
const SPEECH_CACHE = join(process.cwd(), '.cache', 'speech')
const CANDIDATE_VOICE = 'af_heart'

/**
 * Kokoro emits 24kHz; the microphone side of the wire is 16kHz.
 *
 * Linear interpolation with no low-pass, which would be sloppy for something
 * anyone listens to. Nothing does — this feeds a speech recogniser, which is
 * robust to far worse, and the alternative is a filter to maintain in a test.
 */
function resampleForMicrophone(samples: Float32Array, fromRate: number): Buffer {
  const ratio = fromRate / AUDIO_SAMPLE_RATE
  const count = Math.floor(samples.length / ratio)
  const pcm = Buffer.allocUnsafe(count * 2)
  for (let i = 0; i < count; i += 1) {
    const position = i * ratio
    const index = Math.floor(position)
    const fraction = position - index
    const current = samples[index] ?? 0
    const next = samples[index + 1] ?? current
    const value = Math.max(-1, Math.min(1, current + (next - current) * fraction))
    pcm.writeInt16LE(Math.round(value < 0 ? value * 0x8000 : value * 0x7fff), i * 2)
  }
  return pcm
}

async function speechFor(text: string): Promise<Buffer> {
  const key = createHash('sha256').update(`${CANDIDATE_VOICE}:${text}`).digest('hex').slice(0, 16)
  const cached = join(SPEECH_CACHE, `${key}.pcm`)
  if (existsSync(cached)) return readFileSync(cached)

  const model = await preloadKokoro()
  const audio = await model.generate(text, { voice: CANDIDATE_VOICE })
  const pcm = resampleForMicrophone(audio.audio as Float32Array, audio.sampling_rate)

  if (pcm.length > 0) {
    mkdirSync(SPEECH_CACHE, { recursive: true })
    writeFileSync(cached, pcm)
  }
  return pcm
}

async function main() {
  const runStartedAt = Date.now()
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
  /** Set when the candidate's voiced audio ends; the gap is measured from it. */
  let stoppedTalkingAt = 0
  /** How long the candidate waited in silence, per turn. */
  const gaps: number[] = []

  socket.on('message', (data, isBinary) => {
    if (isBinary) {
      audioBytes += (data as Buffer).length
      if (firstAudioAt === null && turnStartedAt > 0) firstAudioAt = Date.now() - turnStartedAt
      // First sound of a turn: either a backchannel clip or the reply itself.
      if (stoppedTalkingAt > 0) {
        gaps.push(Date.now() - stoppedTalkingAt)
        stoppedTalkingAt = 0
      }
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
    // The moment the candidate actually stops talking. Everything the listener
    // experiences as "the gap" is measured from here, not from the start of the
    // sentence — the trailing silence below is the endpointing window.
    stoppedTalkingAt = Date.now()
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
  /*
   * The code is updated before the fix is claimed, and that matters.
   *
   * Without this the harness says "I think that's fixed now" while the editor
   * contents the interviewer can see are still the untouched starter — and a
   * good interviewer challenges the contradiction rather than running anything.
   * It did exactly that ("what fix did you make?"), and the run_tests check
   * failed for being a bad scenario rather than a broken tool.
   */
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
          '            last_error = exc\n            if attempt < max_attempts - 1:\n' +
          '                sleep(base_delay * (2 ** attempt))\n    raise last_error\n',
      },
    ],
  })
  await sleep(600)

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

  console.log('\nThe gap')

  /*
   * How long the candidate sits in silence after they stop talking.
   *
   * This is the number the backchannel clips exist to move. Without them the
   * floor is endpointing (~300ms) plus DeepSeek's first token (~1100ms) plus
   * Cartesia (~40ms) — call it 1.5s, which reads as a dropped call rather than
   * a pause for thought. A clip fires as soon as endpointing does, so the first
   * sound arrives while the reply is still being written.
   *
   * Some turns get no clip on purpose, so the slowest gap here should still look
   * like the un-masked number. It is the median that should have moved.
   */
  const sorted = [...gaps].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  console.log(
    `  ${DIM}·${RESET} gaps: ${gaps.map((g) => `${g}ms`).join(', ')} ${DIM}(median ${median}ms over ${gaps.length} turns)${RESET}`,
  )
  check(
    sorted.length > 0 && sorted[0] < 1200,
    'at least one turn answers faster than the un-masked floor',
    `fastest ${sorted[0]}ms`,
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

    /*
     * Cuts in as soon as the turn starts, rather than waiting for speech.
     *
     * Waiting for `speaking` looks stricter and is in fact unreliable: the
     * interviewer is deliberately terse, so a reply can be two seconds of audio,
     * which is less time than it takes to stream an interruption in and have
     * Deepgram commit to it. Three attempts in a row missed for that reason —
     * the reply had ended on its own, so there was nothing left to interrupt and
     * the failure said nothing about barge-in.
     *
     * `thinking` is a genuine barge-in window and a deterministic one. It is
     * also the more realistic case now that a backchannel clip is playing during
     * it: cutting in over the interviewer's "mm-hm" is exactly the thing that
     * has to abort the pending reply and flush what is already queued.
     */
    const startDeadline = Date.now() + 15_000
    const midTurn = () => states[states.length - 1] === 'thinking' || states[states.length - 1] === 'speaking'
    /*
     * Keeps streaming silence while waiting, exactly as an open microphone does.
     *
     * Simply sleeping here leaves a hole in the audio timeline, and Deepgram
     * raises `SpeechStarted` on a transition out of silence — with no silence
     * sent, the interruption that follows is not a transition and the event
     * never fires. That is what made this test fail intermittently for reasons
     * that had nothing to do with the server: barge-in was never triggered at
     * all, so of course no flush followed.
     */
    const quiet = Buffer.alloc(FRAME)
    while (Date.now() < startDeadline && !midTurn()) {
      socket.send(quiet, { binary: true })
      await sleep(20)
    }
    if (!midTurn()) continue

    /*
     * A beat of silence before cutting in, and it is load-bearing.
     *
     * The server advances to `thinking` on Deepgram's `speech_final`, which
     * arrives well before `utterance_end_ms` (1s) has elapsed. Deepgram's voice
     * activity detector still considers that speech segment open, so an
     * interruption sent immediately is folded into it — same segment, no
     * transition, no `SpeechStarted`, no barge-in. Waiting lets the segment
     * close so the cut-in registers as new speech.
     *
     * This also models what a person actually does: you interrupt once you hear
     * the interviewer start, not in the same breath as your own last word.
     */
    for (let i = 0; i < 30; i += 1) {
      socket.send(quiet, { binary: true })
      await sleep(20)
    }
    if (!midTurn()) continue

    const flushesBefore = flushes
    const audioBefore = audioBytes
    const statesBefore = states.length

    // Straight in, with no synthesis delay.
    await speakAsCandidate(interruption, 8)
    console.log(
      `    ${DIM}attempt ${attempts}: states ${states.slice(statesBefore).join(' → ') || '(none)'}${RESET}`,
    )

    // Only a meaningful attempt if the turn had not already finished on its own.
    if (midTurn() || flushes > flushesBefore) caughtSpeaking = true
    await sleep(1500)

    if (flushes > flushesBefore) {
      interrupted = true
      detail = `${flushes - flushesBefore} flush(es) on attempt ${attempts}, ${audioBytes - audioBefore} bytes after cut-in`
    } else if (caughtSpeaking) {
      detail = `caught it speaking on attempt ${attempts} but no flush followed`
    }
  }

  check(caughtSpeaking, 'interviewer is mid-turn when the interruption lands', `${attempts} attempt(s)`)
  check(interrupted, 'server tells the browser to flush buffered audio', detail)
  check(
    states[states.length - 1] !== 'speaking',
    'leaves the speaking state',
    `state now "${states[states.length - 1]}"`,
  )

  send({ type: 'end' })
  await sleep(400)
  socket.close()

  /* ------------------------------------------------------ a spoken round, twice
   *
   * Everything above is a coding round. A spoken round takes a different path
   * end to end — a different prompt, a different tool list, and a coverage
   * grader that no coding round ever starts — and none of it had been driven
   * over a real socket.
   *
   * The round is then *resumed* on a second connection, which is the part that
   * most needed this. Resume is covered by `verify:tools` against a stub, so the
   * one thing never tested was the shape of the rebuilt history reaching the
   * real API. A provider that rejected it would fail on the first turn of every
   * resumed round, and nothing would have caught that before a live session.
   */
  console.log('\nA spoken round, and resuming it')
  {
    /** Opens a socket and collects everything worth asserting on. */
    const openRound = (resume?: { role: 'candidate' | 'interviewer'; text: string; at: number }[]) => {
      const ws = new WebSocket(`ws://localhost:${PORT}`)
      const seen = {
        ready: false,
        errors: [] as string[],
        interviewer: [] as string[],
        candidate: [] as string[],
        objectives: null as { covered: number[]; total: number } | null,
      }
      ws.on('message', (data: Buffer, isBinary: boolean) => {
        if (isBinary) return
        const message = JSON.parse(data.toString()) as ServerMessage
        if (message.type === 'ready') seen.ready = true
        else if (message.type === 'error') seen.errors.push(message.message)
        else if (message.type === 'objective') {
          seen.objectives = { covered: message.covered, total: message.total }
        } else if (message.type === 'transcript') {
          if (message.role === 'interviewer') seen.interviewer.push(message.text)
          else if (message.final) seen.candidate.push(message.text)
        }
      })
      return new Promise<{ ws: WebSocket; seen: typeof seen }>((resolve) => {
        ws.on('open', () => {
          ws.send(
            JSON.stringify({
              type: 'start',
              problemSlug: 'concept-database-index',
              language: 'typescript',
              ...(resume ? { resume } : {}),
            } satisfies ClientMessage),
          )
          resolve({ ws, seen })
        })
      })
    }

    const stream = async (ws: WebSocket, audio: Buffer) => {
      for (let offset = 0; offset < audio.length; offset += FRAME) {
        ws.send(audio.subarray(offset, Math.min(offset + FRAME, audio.length)), { binary: true })
        await sleep(20)
      }
      const silence = Buffer.alloc(FRAME)
      for (let i = 0; i < 40; i++) {
        ws.send(silence, { binary: true })
        await sleep(20)
      }
    }

    const first = await openRound()
    const readyBy = Date.now() + 20_000
    while (!first.seen.ready && Date.now() < readyBy) await sleep(100)
    check(first.seen.ready, 'a spoken round starts')

    /*
     * The interviewer opens, before anyone has said anything to it.
     *
     * This is the regression that matters most. There used to be no opening turn
     * at all: the round began in silence and the first thing spoken was the
     * 45-second idle nudge, which — having never asked a question — produced
     * "I'll wait for them to answer" out loud, in the third person.
     */
    const openedBy = Date.now() + 25_000
    while (first.seen.interviewer.length === 0 && Date.now() < openedBy) await sleep(200)
    check(
      first.seen.interviewer.length > 0,
      'the interviewer opens the round without being spoken to first',
      `"${first.seen.interviewer.join(' ').slice(0, 60)}"`,
    )
    check(
      !/\bthey\b|\btheir\b|\bthem\b/i.test(first.seen.interviewer.join(' ')),
      'and talks to the candidate rather than about them',
    )

    // Reaches essential point 1 — what an index physically is — and nothing else.
    const answer = await speechFor(
      'The database builds a separate B-tree holding that column sorted, with a pointer back to each row.',
    )
    await stream(first.ws, answer)

    const gradedBy = Date.now() + 40_000
    while (first.seen.objectives === null && Date.now() < gradedBy) await sleep(200)

    check(first.seen.candidate.length > 0, 'transcribes the answer', `"${first.seen.candidate.join(' ').slice(0, 50)}"`)
    check(
      first.seen.objectives !== null && first.seen.objectives.covered.length > 0,
      'the grader marks a point without the interviewer being asked to',
      first.seen.objectives ? `covered ${first.seen.objectives.covered.join(', ')} of ${first.seen.objectives.total}` : 'nothing arrived',
    )
    check(first.seen.errors.length === 0, 'no errors', first.seen.errors.join('; '))

    // Everything said, as the browser's record would hand it back.
    const transcript = [
      ...first.seen.interviewer.map((text) => ({ role: 'interviewer' as const, text, at: Date.now() })),
      ...first.seen.candidate.map((text) => ({ role: 'candidate' as const, text, at: Date.now() })),
    ]
    first.ws.send(JSON.stringify({ type: 'end' } satisfies ClientMessage))
    await sleep(300)
    first.ws.close()
    await sleep(500)

    const again = await openRound(transcript)
    const resumedBy = Date.now() + 20_000
    while (!again.seen.ready && Date.now() < resumedBy) await sleep(100)
    check(again.seen.ready, 'and resumes on a fresh connection', `${transcript.length} lines replayed`)

    // The tally is derived from the transcript, so it comes back on its own —
    // nothing about coverage is persisted anywhere.
    const regradedBy = Date.now() + 40_000
    while (again.seen.objectives === null && Date.now() < regradedBy) await sleep(200)
    check(
      again.seen.objectives !== null && again.seen.objectives.covered.length > 0,
      'recovers the tally from the transcript alone',
      again.seen.objectives ? `covered ${again.seen.objectives.covered.join(', ')}` : 'nothing arrived',
    )
    // The real point of resuming against the live API: a rebuilt history that
    // the provider rejects fails here, not in front of the candidate.
    check(again.seen.errors.length === 0, 'the rebuilt history is accepted by the model', again.seen.errors.join('; '))

    again.ws.send(JSON.stringify({ type: 'end' } satisfies ClientMessage))
    await sleep(300)
    again.ws.close()
  }

  /*
   * A rapid-fire drill on the same server.
   *
   * Only two questions' worth, and with a short clock, because what is being
   * checked is the *shape* of the loop rather than the bank. Three things can
   * only be seen here:
   *
   *   1. The clock starts when the question stops being spoken, not when it
   *      starts. Everything about the fairness of the format hangs off that one
   *      TTS callback, and nothing offline can observe it.
   *   2. An answer is filed against the question it was given to. The server
   *      does the bucketing precisely so a late transcript cannot land under the
   *      next question, and only a real Deepgram round trip has late transcripts.
   *   3. Speech during a question does not reach the transcript at all.
   */
  console.log('\nRapid-fire drill')
  {
    const ws = new WebSocket(`ws://localhost:${PORT}`)
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })

    const asked: number[] = []
    const listening: { index: number; at: number }[] = []
    const answered: { index: number; text: string }[] = []
    const errors: string[] = []
    let complete = false
    let questionAudioBytes = 0

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        questionAudioBytes += (data as Buffer).length
        return
      }
      const message = JSON.parse(data.toString()) as ServerMessage
      if (message.type === 'drill-question') asked.push(message.index)
      else if (message.type === 'drill-listening')
        listening.push({ index: message.index, at: Date.now() })
      else if (message.type === 'drill-answered')
        answered.push({ index: message.index, text: message.text })
      else if (message.type === 'drill-complete') complete = true
      else if (message.type === 'error') errors.push(message.message)
    })

    ws.send(JSON.stringify({ type: 'start-drill', setSlug: 'drill-typescript' } satisfies ClientMessage))

    /** Streams into *this* socket rather than the interview one above. */
    const answerInto = async (audio: Buffer) => {
      for (let offset = 0; offset < audio.length; offset += FRAME) {
        ws.send(audio.subarray(offset, Math.min(offset + FRAME, audio.length)), { binary: true })
        await sleep(20)
      }
      const silence = Buffer.alloc(FRAME)
      for (let i = 0; i < 30; i += 1) {
        ws.send(silence, { binary: true })
        await sleep(20)
      }
    }

    const answer1 = await speechFor(
      'Static types catch errors at compile time, and the types disappear at runtime because it ' +
        'compiles down to JavaScript.',
    )

    // Wait for the first question to be spoken and the clock to open.
    const openDeadline = Date.now() + 30_000
    while (listening.length === 0 && Date.now() < openDeadline) await sleep(100)
    check(asked[0] === 0, 'asks the first question', `index ${asked[0]}`)
    check(questionAudioBytes > 0, 'speaks it aloud', `${questionAudioBytes} bytes`)
    check(
      listening.length === 1,
      'and opens the clock only once the question has been said',
      `${listening.length} window(s)`,
    )

    await answerInto(answer1)
    ws.send(JSON.stringify({ type: 'drill-next' } satisfies ClientMessage))

    const answeredDeadline = Date.now() + 20_000
    while (answered.length === 0 && Date.now() < answeredDeadline) await sleep(100)
    check(
      answered[0]?.index === 0,
      'files the answer against the question it was given to',
      `index ${answered[0]?.index}`,
    )
    check(
      (answered[0]?.text ?? '').toLowerCase().includes('compile'),
      'with what was actually said',
      `"${(answered[0]?.text ?? '').slice(0, 60)}"`,
    )

    // Question two is now being read. Anything said over it must be discarded,
    // not filed as the answer to it.
    const nextDeadline = Date.now() + 25_000
    while (asked.length < 2 && Date.now() < nextDeadline) await sleep(100)
    check(asked[1] === 1, 'moves straight on to the next question', `index ${asked[1]}`)

    ws.send(JSON.stringify({ type: 'end' } satisfies ClientMessage))
    await sleep(300)
    ws.close()

    check(errors.length === 0, 'no errors on the drill path', errors.join('; '))
    check(!complete, 'the run is not reported finished before its last question')
  }

  child.kill()
  await sleep(300)

  /*
   * What this run cost, printed every time.
   *
   * Only one metered service is left on this path, and it is the one that bills
   * wall-clock rather than words — so the number goes up simply by the script
   * taking longer, which is worth seeing. Speech on both sides is now local and
   * free; this used to be the line that reported a drained Cartesia allowance
   * after the fact.
   */
  const audioMinutes = (Date.now() - runStartedAt) / 60_000
  console.log(
    `\n${DIM}This run: ~${audioMinutes.toFixed(1)} min of Deepgram streaming` +
      ` ≈ $${(audioMinutes * 0.0048).toFixed(3)}, plus a few DeepSeek turns.` +
      ` Speech synthesis was local and free.${RESET}`,
  )

  console.log(
    failures === 0
      ? `\n${GREEN}Voice server verified end to end.${RESET}\n`
      : `\n${RED}${failures} check(s) failed.${RESET}\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

/*
 * A clean exit rather than a stack trace.
 *
 * This script needs Deepgram and Cartesia credit as well as DeepSeek, and the
 * failure that gets you is an expired balance — which surfaces as a WebSocket
 * handshake rejection deep inside `speechFor` and reads like a bug in the code
 * under test. It is not. Say which service and what to do about it.
 */
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\n${RED}Could not complete the run.${RESET}\n  ${message}\n`)
  if (/out of credit|rejected the key/i.test(message)) {
    console.error(
      `  ${DIM}This script drives the real pipeline end to end, so it needs a working` +
        ` account for all three services.${RESET}\n`,
    )
  }
  process.exit(1)
})
