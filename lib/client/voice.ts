'use client'

import type { Language } from '@/lib/problems/types'
import type { ClientMessage, ServerMessage, TurnState } from '@/server/protocol'
import { AudioSession } from '@/lib/audio/session'

/**
 * Browser end of the voice pipeline: joins the microphone, the WebSocket, and
 * the speakers.
 *
 * Kept out of React entirely. Audio frames arrive 50 times a second and the
 * transcript changes constantly; routing that through component state would
 * re-render the editor on every frame. React subscribes to a small snapshot
 * instead, and everything else stays here.
 */

export interface TranscriptLine {
  role: 'candidate' | 'interviewer'
  text: string
  final: boolean
  /** Wall clock when this line arrived — the pipeline's clock, not the speaker's. */
  at: number
  /** Position and length in the audio, in seconds. Candidate finals only. */
  start?: number
  spokenSeconds?: number
}

export interface Observation {
  note: string
  axis: 'content' | 'delivery'
  significance: 'strength' | 'concern'
  at: number
}

export interface RoundOutcome {
  verdict: 'strong' | 'solid' | 'mixed' | 'weak'
  summary: string
  covered: number[]
  points: { text: string; essential: boolean }[]
}

export interface VoiceSnapshot {
  status: 'idle' | 'connecting' | 'live' | 'error'
  turn: TurnState
  /** True while the interviewer's audio is actually coming out of the speakers. */
  speaking: boolean
  muted: boolean
  /** True while the talk key is held down. Drives the on-screen indicator. */
  holding: boolean
  transcript: TranscriptLine[]
  /**
   * Moments the interviewer flagged for the report.
   *
   * Deliberately not rendered anywhere in the interview room. Seeing the
   * interviewer's private notes appear live would change how you behave for the
   * rest of the round, which is exactly what a practice run must not do.
   */
  observations: Observation[]
  /**
   * Expected points reached so far, by index, and how many there are.
   *
   * Indices only while the round runs: the text is the answer key, and putting
   * it on screen mid-question would hand over what is being asked.
   */
  objectives: { covered: number[]; total: number; essential: number } | null
  /** Set when the interviewer ends the round. Null while it is still running. */
  outcome: RoundOutcome | null
  error: string | null
}

const INITIAL: VoiceSnapshot = {
  status: 'idle',
  turn: 'idle',
  speaking: false,
  muted: false,
  holding: false,
  transcript: [],
  observations: [],
  objectives: null,
  outcome: null,
  error: null,
}

/** How many times to come back after a dropped connection before giving up. */
const MAX_RECONNECT_ATTEMPTS = 5
/** Doubling from here: 0.5s, 1s, 2s, 4s, 8s. */
const RECONNECT_BASE_MS = 500

export class VoiceClient {
  #socket: WebSocket | null = null
  #audio: AudioSession | null = null
  #snapshot: VoiceSnapshot = INITIAL
  #listeners = new Set<() => void>()

  /** Kept so a reconnection can say hello again without the caller's help. */
  #url = ''
  #problemSlug = ''
  #language: Language = 'typescript'
  /** True once the candidate has ended it themselves; suppresses the retry. */
  #closing = false
  #attempts = 0
  /** Fires when the interviewer asks for the tests to be run. */
  #onRunTests: (() => void) | null = null

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Stable reference between changes, so useSyncExternalStore doesn't loop. */
  getSnapshot = (): VoiceSnapshot => this.#snapshot

  #update(patch: Partial<VoiceSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of this.#listeners) listener()
  }

  onRunTests(handler: () => void): void {
    this.#onRunTests = handler
  }

  async connect(options: {
    url: string
    problemSlug: string
    language: Language
    /**
     * What was already said, when this round is being picked up again.
     *
     * Seeded into the snapshot as well as sent to the server, and both halves
     * matter. The panel shows the earlier conversation rather than an empty box,
     * and — less obviously — the record keeps it: `recordTranscript` replaces the
     * round's transcript wholesale from this list, so reconnecting with an empty
     * one would erase the first half of the interview from the report.
     */
    resume?: { role: 'candidate' | 'interviewer'; text: string; at: number }[]
  }): Promise<void> {
    if (this.#socket) return
    const resumed: TranscriptLine[] = (options.resume ?? []).map((line) => ({
      ...line,
      final: true,
    }))
    this.#update({
      status: 'connecting',
      error: null,
      transcript: resumed,
      observations: [],
      objectives: null,
      outcome: null,
    })

    // Microphone first: if permission is refused there is no point opening a
    // socket, and the failure is much clearer this way round.
    const audio = new AudioSession({
      onFrame: (pcm) => {
        if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(pcm)
      },
      onSpeakingChange: (speaking) => this.#update({ speaking }),
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
    // Starts muted: with push-to-talk the microphone is closed until you ask
    // for it, which is both the turn-taking contract and the reason an idle
    // session costs nothing to keep open.
    audio.setMuted(true)
    this.#audio = audio

    this.#url = options.url
    this.#problemSlug = options.problemSlug
    this.#language = options.language
    this.#closing = false
    this.#attempts = 0
    this.#open(options.resume ?? [])
  }

  /**
   * Opens the socket and says hello. Used for the first connection and for every
   * reconnection, which is why it takes the transcript rather than reading it
   * from the connect options: a reconnection resumes from everything said since.
   */
  #open(resume: { role: 'candidate' | 'interviewer'; text: string; at: number }[]): void {
    const socket = new WebSocket(this.#url)
    socket.binaryType = 'arraybuffer'
    this.#socket = socket

    socket.onopen = () => {
      this.#send({
        type: 'start',
        problemSlug: this.#problemSlug,
        language: this.#language,
        ...(resume.length > 0 ? { resume } : {}),
      })
    }

    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.#audio?.play(event.data)
        return
      }
      this.#handle(JSON.parse(String(event.data)) as ServerMessage)
    }

    // Deliberately silent. An error is always followed by a close, and reporting
    // both means the retry is announced and then immediately contradicted.
    socket.onerror = () => {}

    socket.onclose = () => {
      this.#socket = null
      if (this.#closing) {
        this.#update({ status: 'idle', turn: 'idle' })
        return
      }
      this.#reconnect()
    }
  }

  /**
   * Comes back after a dropped connection, and resumes rather than restarting.
   *
   * Without this a drop mid-answer looks exactly like the interviewer going
   * quiet: the transcript stops, nothing errors, and you find out by noticing.
   * The retry carries everything said so far, so the server rebuilds its history
   * and the coverage grader recomputes the tally — resuming is already the
   * supported path, this just takes it automatically.
   *
   * The audio session is left alone throughout. The microphone permission and
   * the worklets survive a socket drop, and tearing them down would turn a
   * one-second blip into a second permission prompt.
   */
  #reconnect(): void {
    if (this.#attempts >= MAX_RECONNECT_ATTEMPTS) {
      this.#update({
        status: 'error',
        error: 'Lost the connection to the voice server. Is `pnpm dev:voice` running?',
      })
      return
    }

    // Backing off rather than hammering: the overwhelmingly likely cause is the
    // voice server restarting, and it needs a moment to come back.
    const delay = RECONNECT_BASE_MS * 2 ** this.#attempts
    this.#attempts += 1
    this.#update({
      status: 'connecting',
      turn: 'idle',
      speaking: false,
      holding: false,
      error: `Connection dropped — reconnecting (${this.#attempts} of ${MAX_RECONNECT_ATTEMPTS})…`,
    })

    setTimeout(() => {
      if (this.#closing) return
      // Everything said so far, including from before the drop. Interim lines
      // are excluded: a guess that was never confirmed is not part of the
      // record, and replaying one would put words in the candidate's mouth.
      this.#open(
        this.#snapshot.transcript
          .filter((line) => line.final)
          .map(({ role, text, at }) => ({ role, text, at })),
      )
    }, delay)
  }

  #handle(message: ServerMessage): void {
    switch (message.type) {
      case 'ready':
        // Clears the retry budget as well as the message: a session that drops
        // once an hour for eight hours should reconnect every time, not five
        // times and then give up for good.
        this.#attempts = 0
        this.#update({ status: 'live', error: null })
        break

      case 'state':
        this.#update({ turn: message.turn })
        break

      case 'flush-audio':
        // The other half of barge-in. Everything already queued is now wrong.
        this.#audio?.flush()
        break

      case 'transcript': {
        const transcript = [...this.#snapshot.transcript]
        const last = transcript[transcript.length - 1]
        // Interim lines replace the previous interim from the same speaker
        // rather than accumulating, so the panel updates in place.
        if (last && !last.final && last.role === message.role) {
          transcript[transcript.length - 1] = { ...message, at: last.at }
        } else {
          transcript.push({ ...message, at: Date.now() })
        }
        this.#update({ transcript })
        break
      }

      case 'run-tests':
        this.#onRunTests?.()
        break

      case 'objective':
        this.#update({
          objectives: {
            covered: message.covered,
            total: message.total,
            essential: message.essential,
          },
        })
        break

      case 'round-complete':
        this.#update({
          outcome: {
            verdict: message.verdict,
            summary: message.summary,
            covered: message.covered,
            points: message.points,
          },
        })
        break

      case 'observation': {
        const { note, axis, significance, at } = message
        this.#update({
          observations: [...this.#snapshot.observations, { note, axis, significance, at }],
        })
        break
      }

      case 'error':
        this.#update(
          message.fatal
            ? { status: 'error', error: message.message }
            : { error: message.message },
        )
        break
    }
  }

  #send(message: ClientMessage): void {
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.send(JSON.stringify(message))
    }
  }

  /** Push the editor contents so the interviewer can see the code. */
  sendCode(files: { path: string; content: string }[], activePath: string): void {
    this.#send({ type: 'code', files, activePath })
  }

  sendTestResults(results: {
    passed: number
    total: number
    failing: string[]
    compileError?: string
  }): void {
    this.#send({ type: 'test-results', ...results })
  }

  /**
   * Push-to-talk. Opens the microphone only while held.
   *
   * Two things fall out of this beyond the turn-taking. The microphone is muted
   * the rest of the time, so Deepgram — which bills the audio it receives — sees
   * only what you actually said. And nothing you type, mutter, or play in
   * another tab reaches the transcript.
   */
  setTalking(holding: boolean): void {
    // A held key must not reopen a microphone the session closed. Pressing to
    // talk during a paused session is a mistake, not an instruction, and the
    // release path still runs so nothing is left latched.
    if (holding && this.#snapshot.muted) return
    this.#audio?.setMuted(!holding)
    this.#update({ holding })
    this.#send({ type: 'talk', holding })
  }

  /** Tell the interviewer a text hint was taken, so it doesn't repeat it. */
  noteHint(level: number, text: string): void {
    this.#send({ type: 'hint-taken', level, text })
  }

  toggleMute(): void {
    this.setMuted(!this.#snapshot.muted)
  }

  /**
   * Force the microphone open or closed, regardless of the talk key.
   *
   * Used by the session pause, where the decision is not the candidate's moment
   * to moment one — which is why `setTalking` refuses to open the microphone
   * while this holds. Without that, holding the talk key would quietly undo the
   * pause.
   */
  setMuted(muted: boolean): void {
    if (this.#snapshot.muted === muted) return
    this.#audio?.setMuted(muted)
    this.#send({ type: 'mic', enabled: !muted })
    this.#update({ muted })
  }

  async disconnect(): Promise<void> {
    // Set before the close, or the socket's own close handler reads this as a
    // drop and starts reconnecting to a session the candidate just ended.
    this.#closing = true
    this.#send({ type: 'end' })
    this.#socket?.close()
    this.#socket = null
    await this.#audio?.stop()
    this.#audio = null
    this.#snapshot = INITIAL
    for (const listener of this.#listeners) listener()
  }
}
