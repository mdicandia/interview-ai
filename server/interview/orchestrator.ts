import type { DiscussionProblem, Language, Problem } from '@/lib/problems/types'
import type { LLMProvider, Message, ToolCall } from '../pipeline/llm'
import { parseObservation, toolsFor, type Observation } from './tools'
import { loadBackchannels, type Backchannel } from './backchannel'
import { SentenceSplitter } from '../pipeline/sentences'
import { createSttClient, type SttClient } from '../pipeline/stt'
import type { TtsClient } from '../pipeline/tts'
import { createVoice } from '../pipeline/voice'
import type { ServerMessage, TurnState } from '../protocol'
import {
  buildFrozenPrefix,
  buildIdleNote,
  buildVolatileNote,
  type VolatileContext,
} from './prompt'

/**
 * One interview session: owns the STT/TTS/LLM clients and the turn state machine.
 *
 * The state machine is the heart of the thing:
 *
 *   idle      --speech detected-->  listening
 *   listening --endpointing------>  thinking     (backchannel plays here)
 *   thinking  --first sentence--->  speaking
 *   speaking  --response done---->  idle
 *   speaking  --candidate talks-->  listening    (barge-in)
 *   idle      --silence + no typing--> thinking  (proactive nudge)
 *
 * The last transition is what separates an interviewer from a chatbot. A chatbot
 * waits to be spoken to. An interviewer notices you have been staring at a blank
 * function for forty seconds and asks what you are thinking.
 */

export interface SessionConfig {
  problem: Problem | DiscussionProblem
  language: Language
  llm: LLMProvider
  deepgramKey: string
  cartesiaKey: string
  /** Sends a control message or audio frame to the browser. */
  send: (message: ServerMessage) => void
  sendAudio: (pcm: Buffer) => void
}

/**
 * Removes bracketed meta-text before anything is spoken.
 *
 * The interviewer receives bracketed status notes — [tests: 3 of 5 passing] —
 * and is told they are context rather than speech. It also has a tool for
 * recording private notes. Observed live: it conflated the two and emitted
 * `[Note: the tests pass but the code shown is the *unfixed* original — ...]`
 * as ordinary content, which goes straight to the speech synthesiser and out of
 * the speakers.
 *
 * The prompt forbids this and is not enough on its own. Stripping here costs
 * nothing real: an interviewer talking about an array says "square bracket" as
 * words, never as a literal `[`.
 */
function stripMetaNotes(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Silence *and* no typing for this long before the interviewer speaks up. */
const IDLE_NUDGE_MS = 45_000

/** Never nudge twice in a row without the candidate having said something. */
const MIN_MS_BETWEEN_NUDGES = 90_000

export class InterviewSession {
  #config: SessionConfig
  #frozenPrefix: string

  #stt: SttClient | null = null
  #tts: TtsClient | null = null

  #state: TurnState = 'idle'
  #history: Message[] = []

  /** Final transcript chunks for the current candidate turn, not yet answered. */
  #pending: string[] = []

  /** Volatile editor state, refreshed by the browser as they type. */
  #volatile: VolatileContext = { files: [], activePath: '' }

  /** Aborts the in-flight LLM stream on barge-in. */
  #abort: AbortController | null = null
  #contextId = 0

  #backchannel: Backchannel = loadBackchannels()

  /** Set once the browser drives turns explicitly; see `setTalking`. */
  #pushToTalk = false

  #idleTimer: ReturnType<typeof setTimeout> | null = null
  #lastNudgeAt = 0
  #lastCodeChangeAt = Date.now()

  /** Everything said, for the post-session report. */
  readonly transcript: { role: 'candidate' | 'interviewer'; text: string; at: number }[] = []

  /** Hints taken from the text panel, for the report. */
  readonly hintsTaken: { level: number; text: string; at: number }[] = []

  /** Moments the interviewer flagged live, via `note_observation`. */
  readonly observations: Observation[] = []

  constructor(config: SessionConfig) {
    this.#config = config
    this.#frozenPrefix = buildFrozenPrefix({ problem: config.problem, language: config.language })
  }

  async start(): Promise<void> {
    this.#tts = await createVoice({
      onAudio: (pcm, contextId) => {
        // Audio for a superseded turn can still be in flight after barge-in.
        if (contextId !== this.#currentContext()) return
        if (this.#state !== 'speaking') this.#setState('speaking')
        this.#config.sendAudio(pcm)
      },
      onDone: (contextId) => {
        if (contextId === this.#currentContext() && this.#state === 'speaking') {
          this.#setState('idle')
          this.#armIdleTimer()
        }
      },
      onError: (error) => this.#config.send({ type: 'error', message: error.message, fatal: false }),
    }, this.#config.cartesiaKey)

    this.#stt = await createSttClient(this.#config.deepgramKey, {
      onSpeechStarted: () => this.#onSpeechStarted(),
      onInterim: (text) =>
        this.#config.send({ type: 'transcript', role: 'candidate', text, final: false }),
      onFinal: (text) => {
        this.#pending.push(text)
        this.#config.send({ type: 'transcript', role: 'candidate', text, final: true })
      },
      // Ignored entirely once push-to-talk is in use: the candidate says when
      // they are done, and a pause for thought must not pre-empt them.
      onUtteranceEnd: () => {
        if (!this.#pushToTalk) void this.#onUtteranceEnd()
      },
      onError: (error) => this.#config.send({ type: 'error', message: error.message, fatal: false }),
      onClose: () => {},
    })

    this.#config.send({ type: 'ready' })
    this.#armIdleTimer()
  }

  /** Raw microphone audio from the browser. */
  pushAudio(pcm: Buffer): void {
    this.#stt?.send(pcm)
  }

  /**
   * Push-to-talk: the candidate is holding the talk key, or has let go.
   *
   * Latches on first use. Once the browser has said it is driving turns
   * explicitly, Deepgram's endpointing stops being allowed to end one — mixing
   * the two would let a mid-sentence pause fire a reply while the candidate is
   * still holding the key down.
   */
  setTalking(holding: boolean): void {
    this.#pushToTalk = true

    if (holding) {
      // Same handling as any other detected speech, so interrupting the
      // interviewer by pressing the key works exactly like interrupting it by
      // talking does.
      this.#onSpeechStarted()
      return
    }

    this.#setState('idle')
    void this.#onUtteranceEnd()
  }

  /** Latest editor contents. Also counts as activity for the nudge timer. */
  updateCode(files: { path: string; content: string }[], activePath: string): void {
    this.#volatile = { ...this.#volatile, files, activePath }
    this.#lastCodeChangeAt = Date.now()
  }

  updateTests(tests: NonNullable<VolatileContext['tests']>): void {
    this.#volatile = { ...this.#volatile, tests }
    // A test run is a real event worth reacting to, not just background state.
    const summary = tests.compileError
      ? `[Their code failed to run: ${tests.compileError.split('\n')[0]}]`
      : `[They ran the tests: ${tests.passed} of ${tests.total} passing.` +
        (tests.failing.length > 0 ? ` Still failing: ${tests.failing.join(', ')}]` : ']')
    void this.#respond(summary)
  }

  /**
   * Records a hint the candidate took from the text panel.
   *
   * Deliberately silent: it goes into the history so the interviewer knows not
   * to repeat the nudge, but it does not trigger a spoken turn. Being told "I
   * see you took a hint" out loud would be both patronising and a needless
   * interruption.
   */
  noteHint(level: number, text: string): void {
    this.hintsTaken.push({ level, text, at: Date.now() })
    this.#history.push({
      role: 'user',
      content:
        `[They pressed the hint button and were shown hint ${level}: "${text}" — ` +
        'do not repeat this nudge, and do not mention that they took it. Carry on.]',
    })
  }

  /**
   * What this session has spent on the metered APIs.
   *
   * Reported because the two services bill on completely different axes, and one
   * of them is counter-intuitive. Cartesia bills what the interviewer *says*, so
   * a quiet round is cheap. Deepgram bills the microphone being *open*, so forty
   * minutes of silent typing costs exactly as much as forty minutes of talking.
   * Without seeing both, the obvious guess about which one to economise on is
   * the wrong one.
   */
  usage(): { spokenCharacters: number; listenedSeconds: number } {
    return {
      spokenCharacters: this.#tts?.charactersSpoken() ?? 0,
      listenedSeconds: this.#stt?.audioSeconds() ?? 0,
    }
  }

  async end(): Promise<void> {
    this.#clearIdleTimer()
    this.#abort?.abort()
    this.#stt?.close()
    this.#tts?.close()
  }

  /* ------------------------------------------------------------------ state */

  #currentContext(): string {
    return `turn-${this.#contextId}`
  }

  #setState(turn: TurnState): void {
    if (this.#state === turn) return
    this.#state = turn
    this.#config.send({ type: 'state', turn })
  }

  #onSpeechStarted(): void {
    if (this.#state === 'speaking' || this.#state === 'thinking') this.#bargeIn()
    this.#setState('listening')
    this.#clearIdleTimer()
  }

  /**
   * Stop talking, immediately.
   *
   * Three things have to happen, and missing any one leaves the interviewer
   * still audible: abort the model so no more sentences are produced, cancel the
   * TTS context so queued audio is dropped server-side, and tell the browser to
   * throw away whatever it has already buffered. The third is the one people
   * forget — the wire is not the last place audio sits.
   */
  #bargeIn(): void {
    this.#abort?.abort()
    this.#abort = null
    this.#tts?.cancel(this.#currentContext())
    this.#contextId += 1
    this.#config.send({ type: 'flush-audio' })
  }

  async #onUtteranceEnd(): Promise<void> {
    const said = this.#pending.join(' ').trim()
    this.#pending = []
    if (said === '') {
      this.#armIdleTimer()
      return
    }
    this.transcript.push({ role: 'candidate', text: said, at: Date.now() })

    /*
     * Only here, and deliberately not inside `#respond`.
     *
     * `#respond` also runs for the idle nudge and for test results coming back,
     * and an acknowledgement makes no sense on either: nobody said anything for
     * it to acknowledge. "Mm-hm" in reply to your own silence is unsettling.
     *
     * No guard against the microphone hearing this and triggering a barge-in on
     * it, which would abort the reply before it started. The browser's echo
     * cancellation is on and is built for exactly this, and the pipeline already
     * plays whole replies through the same speakers with a live mic without
     * barging in on itself. A clip under a second is strictly less exposure than
     * that. Worth knowing that neither case has been tested with real speakers:
     * every run so far has piped synthesised audio straight into the socket, so
     * there has never been an acoustic path at all.
     */
    const clip = this.#backchannel.next()
    if (clip) this.#config.sendAudio(clip)

    await this.#respond(said)
  }

  /* --------------------------------------------------------------- speaking */

  /**
   * Produce and speak one interviewer turn.
   *
   * Up to two passes, because a tool call can arrive with no speech attached —
   * measured: `finish_reason: 'tool_calls'` and an empty content stream. That
   * turn is silent, so without a follow-up the state machine would sit in
   * `thinking` forever. One follow-up is enough; a model that calls a tool
   * silently twice in a row gets no third chance, which bounds both the latency
   * and the bill for a turn.
   *
   * Once anything has been said the loop stops even if a tool was called. Test
   * results arrive on their own as a `test-results` message and trigger a fresh
   * turn, so waiting here would only add silence.
   */
  async #respond(candidateText: string): Promise<void> {
    this.#clearIdleTimer()
    this.#setState('thinking')

    this.#history.push({ role: 'user', content: candidateText })

    const abort = new AbortController()
    this.#abort = abort

    /*
     * A fresh TTS context for every turn, not just after a barge-in.
     *
     * `finish()` sends `continue: false`, which closes the context at Cartesia
     * for good. Reusing the id on the next turn is rejected with "Context has
     * closed and is no longer accepting new inputs" — and the failure is quiet
     * in the worst way: the transcript still streams, so the interviewer appears
     * to be talking while no audio comes out.
     */
    this.#contextId += 1
    const contextId = this.#currentContext()

    let said = ''
    try {
      for (let pass = 0; pass < 2; pass += 1) {
        const { spoken, calls } = await this.#generate(abort, contextId)
        said += spoken
        this.#history.push({
          role: 'assistant',
          content: spoken.trim(),
          ...(calls.length > 0 ? { toolCalls: calls } : {}),
        })
        if (abort.signal.aborted) return
        if (calls.length === 0) break
        this.#dispatch(calls)
        if (spoken.trim() !== '') break
      }
      if (!abort.signal.aborted) this.#tts?.finish(contextId)
    } catch (error) {
      // An abort is the expected outcome of barge-in, not a failure.
      if (!abort.signal.aborted) {
        this.#config.send({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
          fatal: false,
        })
        this.#setState('idle')
        this.#armIdleTimer()
      }
      return
    } finally {
      if (this.#abort === abort) this.#abort = null
    }

    if (said.trim() !== '') {
      this.transcript.push({ role: 'interviewer', text: said.trim(), at: Date.now() })
    } else if (!abort.signal.aborted) {
      // Nothing was spoken, so the TTS 'done' callback will never fire and
      // nothing else would move the state off `thinking`.
      this.#setState('idle')
      this.#armIdleTimer()
    }
  }

  /**
   * One generation pass: speak whatever comes back, collect whatever tools were
   * asked for.
   *
   * The volatile note goes *after* the history rather than into the system
   * prompt, so the cached prefix stays byte-identical. See prompt.ts.
   */
  async #generate(
    abort: AbortController,
    contextId: string,
  ): Promise<{ spoken: string; calls: ToolCall[] }> {
    const turn: Message[] = [
      ...this.#history,
      { role: 'user', content: buildVolatileNote(this.#volatile) },
    ]

    const { text, toolCalls } = await this.#config.llm.stream({
      frozenPrefix: this.#frozenPrefix,
      history: turn,
      signal: abort.signal,
      tools: toolsFor(this.#config.problem.kind),
      // A tool call is spent out of the same budget as the speech, and a
      // `note_observation` with a two-sentence note is most of a 120-token
      // ceiling on its own. That does not truncate visibly — the model simply
      // stops choosing to take notes, which looks like the tool being ignored.
      // Length is governed by the prompt, not by this number.
      maxTokens: 220,
    })

    const say = (sentence: string) => {
      const spoken = stripMetaNotes(sentence)
      if (spoken === '') return
      this.#tts?.speak(spoken, contextId)
      this.#config.send({ type: 'transcript', role: 'interviewer', text: spoken, final: true })
    }

    let spoken = ''
    const splitter = new SentenceSplitter()
    for await (const delta of text) {
      if (abort.signal.aborted) break
      for (const sentence of splitter.push(delta)) {
        spoken += `${sentence} `
        say(sentence)
      }
    }
    if (!abort.signal.aborted) {
      const tail = splitter.flush()
      if (tail) {
        spoken += tail
        say(tail)
      }
    }

    return { spoken, calls: await toolCalls }
  }

  /**
   * Runs the tools the model asked for and appends their results to the history.
   *
   * Every call gets a result message even when it failed, because the API
   * rejects a conversation where an assistant tool call has no answer — and the
   * next turn would then fail rather than the current one, which is a miserable
   * thing to debug.
   */
  #dispatch(calls: ToolCall[]): void {
    for (const call of calls) {
      let result: string

      switch (call.name) {
        case 'run_tests':
          // The browser owns every runtime; the server has none. Results come
          // back later as a `test-results` message, which starts its own turn.
          this.#config.send({ type: 'run-tests' })
          result =
            'The tests are running in their editor now. Do not wait for the result — it ' +
            'will reach you as a status note when it lands.'
          break

        case 'note_observation': {
          const observation = parseObservation(call.arguments)
          if (observation) {
            this.observations.push(observation)
            this.#config.send({ type: 'observation', ...observation })
            result = 'Noted for the report. Say nothing about it.'
          } else {
            result = 'That note could not be read. Carry on; do not retry it.'
          }
          break
        }

        default:
          result = `There is no tool called ${call.name}. Carry on without it.`
      }

      this.#history.push({ role: 'tool', content: result, toolCallId: call.id })
    }
  }

  /* ------------------------------------------------------------------- idle */

  #armIdleTimer(): void {
    this.#clearIdleTimer()
    this.#idleTimer = setTimeout(() => void this.#onIdle(), IDLE_NUDGE_MS)
  }

  #clearIdleTimer(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer)
    this.#idleTimer = null
  }

  async #onIdle(): Promise<void> {
    if (this.#state !== 'idle') return
    // Nudging is a reaction to silence, and silence means nothing when the
    // candidate is the one deciding when to speak.
    if (this.#pushToTalk) return

    // Don't badger someone who is making progress quietly, and don't nudge twice
    // in quick succession — an interviewer who fills every silence is worse than
    // one who never speaks.
    const sinceNudge = Date.now() - this.#lastNudgeAt
    if (sinceNudge < MIN_MS_BETWEEN_NUDGES) {
      this.#armIdleTimer()
      return
    }

    const codeChanged = Date.now() - this.#lastCodeChangeAt < IDLE_NUDGE_MS
    this.#lastNudgeAt = Date.now()
    await this.#respond(buildIdleNote(Math.round(IDLE_NUDGE_MS / 1000), codeChanged))
  }
}
