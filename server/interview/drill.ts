import type { RapidFireSet } from '@/lib/problems/types'
import { createSttClient, type SttClient } from '../pipeline/stt'
import type { TtsClient } from '../pipeline/tts'
import { createVoice } from '../pipeline/voice'
import type { ServerMessage } from '../protocol'

/**
 * A rapid-fire drill: ask, listen for sixty seconds, move on.
 *
 * **There is no model in this loop, and that is the point.**
 *
 * The obvious move is to reuse `InterviewSession` with a short clock. It would
 * be wrong. That class exists to hold a conversation — it decides what to say
 * next, it has tools, it nudges you when you go quiet, it can be interrupted.
 * None of that applies here: the questions are fixed, the order is fixed, and an
 * interviewer running a rapid-fire screen deliberately does *not* react to your
 * answer. Bending the turn machine to fit would produce a round that is bad at
 * both jobs, and it would put a model call in the one path where a two-second
 * pause is a mistake rather than a personality.
 *
 * So this is a timer and a speech queue. What it needs from the pipeline is the
 * same two clients the interview uses, and nothing else. Grading happens once,
 * afterwards, over every answer at once — see app/api/drill/route.ts.
 *
 * The consequence worth knowing: with no model there is no barge-in either.
 * Talking over the question does not stop it, because there is nothing to
 * cancel and no next thing to say. The clock simply has not started yet.
 */

export interface DrillAnswer {
  index: number
  /** The question's own id, so a grader result survives a reordered set. */
  id: string
  /** Everything the candidate said inside the window, joined. */
  text: string
  /** From Deepgram's clock, so it measures speaking rather than the pipeline. */
  spokenSeconds: number
}

export interface DrillConfig {
  set: RapidFireSet
  deepgramKey: string
  cartesiaKey: string
  send: (message: ServerMessage) => void
  sendAudio: (pcm: Buffer) => void
}

export class DrillSession {
  #config: DrillConfig
  #stt: SttClient | null = null
  #tts: TtsClient | null = null

  /** Which question is being asked or answered. -1 before the first. */
  #index = -1
  /** True between `drill-listening` and the window closing. */
  #open = false
  #timer: ReturnType<typeof setTimeout> | null = null

  /** Final chunks for the question currently open. */
  #pending: string[] = []
  #spokenSeconds = 0

  #done = false

  readonly answers: DrillAnswer[] = []

  constructor(config: DrillConfig) {
    this.#config = config
  }

  async start(): Promise<void> {
    this.#tts = await createVoice(
      {
        onAudio: (pcm, contextId) => {
          // A late frame from a question already closed out would talk over the
          // next one. Cheap to check, and impossible to notice if it happens.
          if (contextId !== this.#contextId()) return
          this.#config.sendAudio(pcm)
        },
        // The moment the question has finished being spoken. Everything about
        // the timing of a drill hangs off this one callback.
        onDone: (contextId) => {
          if (contextId === this.#contextId()) this.#openWindow()
        },
        onError: (error) =>
          this.#config.send({ type: 'error', message: error.message, fatal: false }),
      },
      this.#config.cartesiaKey,
    )

    this.#stt = await createSttClient(this.#config.deepgramKey, {
      // Nothing to interrupt, and nothing to decide. A drill's turn boundaries
      // are the clock's, not the speaker's, so all three of Deepgram's
      // turn-taking signals are deliberately ignored.
      onSpeechStarted: () => {},
      onUtteranceEnd: () => {},
      onInterim: (text) =>
        this.#config.send({ type: 'transcript', role: 'candidate', text, final: false }),
      onFinal: ({ text, start, spokenSeconds }) => {
        // Outside a window this is either the tail of the last answer arriving
        // late or the microphone catching the question being read aloud. Neither
        // belongs to the question about to be asked.
        if (!this.#open) return
        this.#pending.push(text)
        this.#spokenSeconds += spokenSeconds
        this.#config.send({
          type: 'transcript',
          role: 'candidate',
          text,
          final: true,
          start,
          spokenSeconds,
        })
      },
      onError: (error) =>
        this.#config.send({ type: 'error', message: error.message, fatal: false }),
      onClose: () => {},
    })

    this.#config.send({ type: 'ready' })
    this.#ask(0)
  }

  pushAudio(pcm: Buffer): void {
    this.#stt?.send(pcm)
  }

  /** The candidate has finished early. Closes the window and moves on. */
  next(): void {
    if (!this.#open) return
    this.#closeWindow()
  }

  usage(): { spokenCharacters: number; listenedSeconds: number } {
    return {
      spokenCharacters: this.#tts?.charactersSpoken() ?? 0,
      listenedSeconds: this.#stt?.audioSeconds() ?? 0,
    }
  }

  async end(): Promise<void> {
    this.#clearTimer()
    this.#open = false
    this.#stt?.close()
    this.#tts?.close()
  }

  /* ----------------------------------------------------------------- private */

  /**
   * A distinct TTS context per question.
   *
   * Not an optimisation — `finish()` closes a Cartesia context permanently, so
   * reusing an id is rejected, and the failure is silent in the worst way: the
   * transcript keeps moving while nothing comes out of the speakers. Same
   * reasoning as `#respond` in the orchestrator; see constraint 5 in AGENTS.md.
   */
  #contextId(): string {
    return `drill-${this.#index}`
  }

  #ask(index: number): void {
    const question = this.#config.set.questions[index]
    if (!question) {
      this.#finish()
      return
    }

    this.#index = index
    this.#pending = []
    this.#spokenSeconds = 0
    this.#config.send({ type: 'drill-question', index })
    this.#config.send({ type: 'state', turn: 'speaking' })

    const contextId = this.#contextId()
    this.#tts?.speak(question.prompt, contextId)
    this.#tts?.finish(contextId)

    /*
     * A drill that never starts its clock because speech synthesis failed would
     * sit on question one forever, in silence, with no way out but a reload. The
     * fallback is generous enough that it never races a working `onDone`.
     */
    this.#timer = setTimeout(() => {
      if (!this.#open && this.#index === index) this.#openWindow()
    }, SPEAK_TIMEOUT_MS)
  }

  #openWindow(): void {
    this.#clearTimer()
    if (this.#done) return

    const question = this.#config.set.questions[this.#index]
    if (!question) return

    this.#open = true
    // Cleared again here rather than only in `#ask`: the microphone is live
    // throughout, and anything Deepgram settled while the question was being
    // read out is echo, not an answer.
    this.#pending = []
    this.#spokenSeconds = 0

    const seconds = this.#config.set.seconds
    this.#config.send({ type: 'drill-listening', index: this.#index, seconds })
    this.#config.send({ type: 'state', turn: 'listening' })
    this.#timer = setTimeout(() => this.#closeWindow(), seconds * 1_000)
  }

  #closeWindow(): void {
    this.#clearTimer()
    if (!this.#open) return
    this.#open = false

    const index = this.#index
    const question = this.#config.set.questions[index]
    if (!question) return

    const text = this.#pending.join(' ').trim()
    // Recorded even when it is empty. Saying nothing is a real outcome of a
    // rapid-fire question — the one the format exists to expose — and dropping
    // the row would grade a nine-question run out of nine.
    this.answers.push({ index, id: question.id, text, spokenSeconds: this.#spokenSeconds })
    this.#config.send({
      type: 'drill-answered',
      index,
      text,
      spokenSeconds: this.#spokenSeconds,
    })

    this.#ask(index + 1)
  }

  #finish(): void {
    this.#done = true
    this.#clearTimer()
    this.#config.send({ type: 'state', turn: 'idle' })
    this.#config.send({ type: 'drill-complete' })
  }

  #clearTimer(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
  }
}

/** How long to wait for speech synthesis before starting the clock anyway. */
const SPEAK_TIMEOUT_MS = 20_000
