'use client'

import type { ClientMessage, ServerMessage } from '@/server/protocol'
import type { DrillResult } from '@/server/interview/drill-grader'
import { AudioSession } from '@/lib/audio/session'

/**
 * Browser end of a rapid-fire drill.
 *
 * A separate class from `VoiceClient` rather than a mode on it. That one carries
 * push-to-talk, editor contents, test results, observations, coverage pips, a
 * closing verdict and a resume path — every one of which is meaningless in a
 * drill, and all of which would have to be widened or made optional to share it.
 * What is genuinely worth reusing is `AudioSession`: the worklets, the
 * resampling and the playback ring buffer are the hard part, and they are used
 * here unchanged.
 *
 * **No reconnection, deliberately.** `VoiceClient` retries a dropped socket
 * because an interview can be rebuilt from its transcript. A drill cannot: the
 * server owns the clock and the question index, and coming back mid-question
 * would either repeat a question or silently skip one. Ten minutes is short
 * enough that starting again is the honest answer, so a drop says so and stops.
 */

export interface DrillAnswer {
  index: number
  text: string
  spokenSeconds: number
}

export interface DrillSnapshot {
  status: 'idle' | 'connecting' | 'live' | 'done' | 'error'
  /** Which question is on screen. -1 before the first one arrives. */
  index: number
  /**
   * Seconds left in the answer window, or null while the question is still
   * being spoken.
   *
   * Ticked here rather than derived from a deadline in the component, because
   * deriving it needs `Date.now()` during render — an impure read that React
   * rightly refuses. Recomputed from the deadline on every tick rather than
   * decremented, so a backgrounded tab where the interval stops firing comes
   * back showing the truth instead of the time it fell asleep at.
   */
  remaining: number | null
  seconds: number
  /** Settled transcript for the current question only. Cleared as each one opens. */
  heard: string
  /** Deepgram's latest guess, not yet settled. Shown dimmed, never accumulated. */
  interim: string
  answers: DrillAnswer[]
  /**
   * Marking, which the client owns rather than the room.
   *
   * The alternative was an effect in the component watching for `done` and
   * firing the POST, which is the shape React now warns about — a synchronous
   * setState in an effect body, cascading a render. Marking is the last step of
   * a drill's own lifecycle, so it belongs on the thing that owns the lifecycle.
   */
  marking: 'idle' | 'marking' | 'marked' | 'failed'
  result: DrillResult | null
  error: string | null
}

const INITIAL: DrillSnapshot = {
  status: 'idle',
  index: -1,
  remaining: null,
  seconds: 0,
  heard: '',
  interim: '',
  answers: [],
  marking: 'idle',
  result: null,
  error: null,
}

/** How often the countdown redraws. Four times a second reads as smooth. */
const TICK_MS = 250

export class DrillClient {
  #socket: WebSocket | null = null
  #audio: AudioSession | null = null
  #snapshot: DrillSnapshot = INITIAL
  #listeners = new Set<() => void>()
  #closing = false

  #setSlug = ''
  #startedAt = 0
  #deadline: number | null = null
  #ticker: ReturnType<typeof setInterval> | null = null

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getSnapshot = (): DrillSnapshot => this.#snapshot

  #update(patch: Partial<DrillSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of this.#listeners) listener()
  }

  async connect(options: { url: string; setSlug: string }): Promise<void> {
    if (this.#socket) return
    this.#update({ ...INITIAL, status: 'connecting' })

    // Microphone first: a refused permission makes the socket pointless, and the
    // failure reads much more clearly this way round.
    const audio = new AudioSession({
      onFrame: (pcm) => {
        if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(pcm)
      },
    })

    try {
      await audio.start()
    } catch (error) {
      this.#update({
        status: 'error',
        error:
          error instanceof Error && error.name === 'NotAllowedError'
            ? 'Microphone access was denied. Allow it in the browser and try again.'
            : `Could not start audio: ${error instanceof Error ? error.message : String(error)}`,
      })
      return
    }
    // Closed until a question has finished being asked. The microphone is only
    // ever open inside an answer window, so nothing said while a question is
    // being read reaches the transcript — and Deepgram, which bills the audio it
    // receives, is not paid to listen to the interviewer.
    audio.setMuted(true)
    this.#audio = audio

    this.#closing = false
    this.#setSlug = options.setSlug
    this.#startedAt = Date.now()
    const socket = new WebSocket(options.url)
    socket.binaryType = 'arraybuffer'
    this.#socket = socket

    socket.onopen = () => this.#send({ type: 'start-drill', setSlug: options.setSlug })
    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.#audio?.play(event.data)
        return
      }
      this.#handle(JSON.parse(String(event.data)) as ServerMessage)
    }
    socket.onerror = () => {}
    socket.onclose = () => {
      this.#socket = null
      if (this.#closing || this.#snapshot.status === 'done') return
      this.#audio?.setMuted(true)
      this.#stopTicking()
      this.#update({
        status: 'error',
        remaining: null,
        error: 'Lost the connection to the voice server. Start the drill again.',
      })
    }
  }

  /** Done answering; move on without waiting out the clock. */
  next(): void {
    if (this.#snapshot.remaining === null) return
    this.#send({ type: 'drill-next' })
  }

  /** How long the run took, for the history row. Zero before it starts. */
  elapsedMs(): number {
    return this.#startedAt === 0 ? 0 : Date.now() - this.#startedAt
  }

  /**
   * Releases the microphone and the socket, keeping the snapshot.
   *
   * Called the moment the last question closes. Marking runs afterwards and
   * needs the answers, so this deliberately does not reset — `disconnect` is the
   * one that throws the run away.
   */
  async disconnectSocket(): Promise<void> {
    this.#closing = true
    this.#stopTicking()
    this.#send({ type: 'end' })
    this.#socket?.close()
    this.#socket = null
    await this.#audio?.stop()
    this.#audio = null
  }

  async disconnect(): Promise<void> {
    await this.disconnectSocket()
    this.#snapshot = INITIAL
    for (const listener of this.#listeners) listener()
  }

  /* ------------------------------------------------------------- the clock */

  #startTicking(seconds: number): void {
    this.#stopTicking()
    this.#deadline = Date.now() + seconds * 1_000
    this.#tick()
    this.#ticker = setInterval(() => this.#tick(), TICK_MS)
  }

  #tick(): void {
    if (this.#deadline === null) return
    const remaining = Math.max(0, Math.ceil((this.#deadline - Date.now()) / 1_000))
    if (remaining !== this.#snapshot.remaining) this.#update({ remaining })
  }

  #stopTicking(): void {
    if (this.#ticker) clearInterval(this.#ticker)
    this.#ticker = null
    this.#deadline = null
  }

  /* ----------------------------------------------------------- the marking */

  /**
   * Sends every answer for one grading pass.
   *
   * Answers are identified by their position in the set, not by the question id
   * — the room never receives the ids it would need to send, and the route holds
   * the set anyway, so asking the browser to carry them would be inventing work
   * for it to get wrong.
   */
  async #mark(): Promise<void> {
    this.#update({ marking: 'marking' })
    try {
      const response = await fetch('/api/drill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setSlug: this.#setSlug, answers: this.#snapshot.answers }),
      })
      const body = (await response.json()) as DrillResult & { error?: string }
      if (!response.ok) throw new Error(body.error ?? `Marking failed (${response.status})`)
      this.#update({ marking: 'marked', result: body })
    } catch (error) {
      this.#update({
        marking: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  #handle(message: ServerMessage): void {
    switch (message.type) {
      case 'ready':
        this.#update({ status: 'live', error: null })
        break

      case 'drill-question':
        // Muted while the question is spoken, so the microphone does not hear it
        // through the speakers and file it as the answer.
        this.#audio?.setMuted(true)
        this.#stopTicking()
        this.#update({ index: message.index, remaining: null, heard: '', interim: '' })
        break

      case 'drill-listening':
        this.#audio?.setMuted(false)
        this.#update({ index: message.index, seconds: message.seconds })
        this.#startTicking(message.seconds)
        break

      case 'drill-answered':
        this.#audio?.setMuted(true)
        this.#stopTicking()
        this.#update({
          remaining: null,
          answers: [
            ...this.#snapshot.answers,
            { index: message.index, text: message.text, spokenSeconds: message.spokenSeconds },
          ],
        })
        break

      case 'drill-complete':
        this.#audio?.setMuted(true)
        this.#stopTicking()
        this.#update({ status: 'done', remaining: null, heard: '', interim: '' })
        // The socket has done its job; holding it open keeps Deepgram billing
        // for an open microphone nobody is talking into.
        void this.disconnectSocket()
        void this.#mark()
        break

      case 'transcript':
        // Only the candidate ever speaks into a transcript here, and only inside
        // a window — the server drops anything outside one. An interim line
        // replaces the last guess rather than being appended, or the panel would
        // show every revision Deepgram made on the way to the sentence.
        this.#update(
          message.final
            ? { heard: `${this.#snapshot.heard} ${message.text}`.trim(), interim: '' }
            : { interim: message.text },
        )
        break

      case 'error':
        this.#update(
          message.fatal ? { status: 'error', error: message.message } : { error: message.message },
        )
        break
    }
  }

  #send(message: ClientMessage): void {
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.send(JSON.stringify(message))
    }
  }
}
