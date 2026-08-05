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
  at: number
}

export interface VoiceSnapshot {
  status: 'idle' | 'connecting' | 'live' | 'error'
  turn: TurnState
  /** True while the interviewer's audio is actually coming out of the speakers. */
  speaking: boolean
  muted: boolean
  transcript: TranscriptLine[]
  error: string | null
}

const INITIAL: VoiceSnapshot = {
  status: 'idle',
  turn: 'idle',
  speaking: false,
  muted: false,
  transcript: [],
  error: null,
}

export class VoiceClient {
  #socket: WebSocket | null = null
  #audio: AudioSession | null = null
  #snapshot: VoiceSnapshot = INITIAL
  #listeners = new Set<() => void>()
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
  }): Promise<void> {
    if (this.#socket) return
    this.#update({ status: 'connecting', error: null, transcript: [] })

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
    this.#audio = audio

    const socket = new WebSocket(options.url)
    socket.binaryType = 'arraybuffer'
    this.#socket = socket

    socket.onopen = () => {
      this.#send({
        type: 'start',
        problemSlug: options.problemSlug,
        language: options.language,
      })
    }

    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.#audio?.play(event.data)
        return
      }
      this.#handle(JSON.parse(String(event.data)) as ServerMessage)
    }

    socket.onerror = () =>
      this.#update({
        status: 'error',
        error: 'Lost the connection to the voice server. Is `pnpm dev:voice` running?',
      })

    socket.onclose = () => {
      if (this.#snapshot.status !== 'error') this.#update({ status: 'idle', turn: 'idle' })
    }
  }

  #handle(message: ServerMessage): void {
    switch (message.type) {
      case 'ready':
        this.#update({ status: 'live' })
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

  /** Tell the interviewer a text hint was taken, so it doesn't repeat it. */
  noteHint(level: number, text: string): void {
    this.#send({ type: 'hint-taken', level, text })
  }

  toggleMute(): void {
    const muted = !this.#snapshot.muted
    this.#audio?.setMuted(muted)
    this.#send({ type: 'mic', enabled: !muted })
    this.#update({ muted })
  }

  async disconnect(): Promise<void> {
    this.#send({ type: 'end' })
    this.#socket?.close()
    this.#socket = null
    await this.#audio?.stop()
    this.#audio = null
    this.#snapshot = INITIAL
    for (const listener of this.#listeners) listener()
  }
}
