import type { Language, Problem } from '@/lib/problems/types'
import type { LLMProvider, Message } from '../pipeline/llm'
import { SentenceSplitter } from '../pipeline/sentences'
import { createSttClient, type SttClient } from '../pipeline/stt'
import { createTtsClient, type TtsClient } from '../pipeline/tts'
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
  problem: Problem
  language: Language
  llm: LLMProvider
  deepgramKey: string
  cartesiaKey: string
  /** Sends a control message or audio frame to the browser. */
  send: (message: ServerMessage) => void
  sendAudio: (pcm: Buffer) => void
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

  #idleTimer: ReturnType<typeof setTimeout> | null = null
  #lastNudgeAt = 0
  #lastCodeChangeAt = Date.now()

  /** Everything said, for the post-session report. */
  readonly transcript: { role: 'candidate' | 'interviewer'; text: string; at: number }[] = []

  /** Hints taken from the text panel, for the report. */
  readonly hintsTaken: { level: number; text: string; at: number }[] = []

  constructor(config: SessionConfig) {
    this.#config = config
    this.#frozenPrefix = buildFrozenPrefix({ problem: config.problem, language: config.language })
  }

  async start(): Promise<void> {
    this.#tts = await createTtsClient(this.#config.cartesiaKey, {
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
    })

    this.#stt = await createSttClient(this.#config.deepgramKey, {
      onSpeechStarted: () => this.#onSpeechStarted(),
      onInterim: (text) =>
        this.#config.send({ type: 'transcript', role: 'candidate', text, final: false }),
      onFinal: (text) => {
        this.#pending.push(text)
        this.#config.send({ type: 'transcript', role: 'candidate', text, final: true })
      },
      onUtteranceEnd: () => void this.#onUtteranceEnd(),
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
    await this.#respond(said)
  }

  /* --------------------------------------------------------------- speaking */

  /**
   * Produce and speak one interviewer turn.
   *
   * The volatile note goes *after* the history rather than into the system
   * prompt, so the cached prefix stays byte-identical. See prompt.ts.
   */
  async #respond(candidateText: string): Promise<void> {
    this.#clearIdleTimer()
    this.#setState('thinking')

    this.#history.push({ role: 'user', content: candidateText })

    const abort = new AbortController()
    this.#abort = abort
    const contextId = this.#currentContext()

    const turn: Message[] = [
      ...this.#history,
      { role: 'user', content: buildVolatileNote(this.#volatile) },
    ]

    let spoken = ''
    try {
      const { text } = await this.#config.llm.stream({
        frozenPrefix: this.#frozenPrefix,
        history: turn,
        signal: abort.signal,
      })

      const splitter = new SentenceSplitter()
      for await (const delta of text) {
        if (abort.signal.aborted) break
        for (const sentence of splitter.push(delta)) {
          spoken += `${sentence} `
          this.#tts?.speak(sentence, contextId)
          this.#config.send({ type: 'transcript', role: 'interviewer', text: sentence, final: true })
        }
      }
      if (!abort.signal.aborted) {
        const tail = splitter.flush()
        if (tail) {
          spoken += tail
          this.#tts?.speak(tail, contextId)
          this.#config.send({ type: 'transcript', role: 'interviewer', text: tail, final: true })
        }
        this.#tts?.finish(contextId)
      }
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

    const said = spoken.trim()
    if (said !== '') {
      this.#history.push({ role: 'assistant', content: said })
      this.transcript.push({ role: 'interviewer', text: said, at: Date.now() })
    }

    // If nothing was spoken (empty response, or aborted before any sentence),
    // the 'done' callback will never fire, so settle the state here.
    if (said === '' && !abort.signal.aborted) {
      this.#setState('idle')
      this.#armIdleTimer()
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
