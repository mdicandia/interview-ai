import WebSocket from 'ws'

/**
 * Cartesia streaming text-to-speech.
 *
 * A persistent socket rather than a request per sentence: the interviewer speaks
 * two or three sentences per turn, and paying connection setup on each one would
 * cost more than the synthesis itself. Sentences are pushed as they arrive from
 * the sentence splitter, so the first one is already playing while the model is
 * still writing the second.
 *
 * Audio comes back as raw PCM rather than WAV. A WAV header per chunk would have
 * to be stripped before the browser could append it to a continuous playback
 * buffer, and headers arriving mid-stream are exactly the kind of thing that
 * produces clicks between sentences.
 */

const CARTESIA_WS = 'wss://api.cartesia.ai/tts/websocket'
const CARTESIA_VERSION = '2024-06-10'

/** Sonic is the low-latency model; ~40ms to first byte in Cartesia's own numbers. */
const MODEL_ID = 'sonic-2'

/** A neutral, unhurried voice. Interviewers do not sound like advertisements. */
export const DEFAULT_VOICE_ID = 'a0e99841-438c-4a64-b679-ae501e7d6091'

/**
 * 16kHz mono PCM throughout the pipeline. Deepgram and the browser worklets use
 * the same rate, so nothing has to resample.
 */
export const SAMPLE_RATE = 16_000

export interface TtsEvents {
  /** Raw PCM16 for the browser to queue. */
  onAudio: (pcm: Buffer, contextId: string) => void
  /** All audio for a context has been sent. */
  onDone: (contextId: string) => void
  onError: (error: Error) => void
}

export interface TtsClient {
  /**
   * Speak one sentence. Sentences sharing a `contextId` are synthesised as one
   * continuous utterance, so prosody carries across them instead of each
   * sentence sounding like a fresh sentence.
   */
  speak(text: string, contextId: string): void
  /** Mark a context finished so Cartesia can flush it. */
  finish(contextId: string): void
  /**
   * Barge-in. Stops caring about everything for this context; any audio still
   * in flight is dropped rather than forwarded.
   *
   * This only stops audio leaving the *server*. Whatever the browser has already
   * buffered must be flushed there too — see lib/audio/playback.ts. Missing that
   * half is the classic barge-in bug: the interviewer keeps talking for another
   * second from the buffer after being interrupted.
   */
  cancel(contextId: string): void
  /**
   * Characters submitted for synthesis so far.
   *
   * Cartesia bills roughly one credit per character, so this is the session's
   * actual spend rather than an estimate from audio duration.
   */
  charactersSpoken(): number
  close(): void
}

interface CartesiaMessage {
  type?: string
  data?: string
  context_id?: string
  error?: string
  done?: boolean
}

export async function createTtsClient(
  apiKey: string,
  events: TtsEvents,
  voiceId = DEFAULT_VOICE_ID,
): Promise<TtsClient> {
  if (!apiKey) throw new Error('CARTESIA_API_KEY is not set — add it to .env.local')

  const url = `${CARTESIA_WS}?api_key=${encodeURIComponent(apiKey)}&cartesia_version=${CARTESIA_VERSION}`
  const socket = new WebSocket(url)

  /** Contexts abandoned by barge-in; late audio for them is discarded. */
  const cancelled = new Set<string>()
  /** Contexts already opened, so we know whether to continue or start fresh. */
  const started = new Set<string>()

  /*
   * Attached before the handshake is awaited, not after.
   *
   * `ws` emits `error` and then, on a failed handshake, emits it again as the
   * socket tears down. With the only listener being the `once` inside the
   * promise below, that second event has no handler — and an unhandled 'error'
   * on an EventEmitter is a hard process crash, so a Cartesia outage took the
   * whole voice server down instead of failing one session.
   */
  let connected = false
  socket.on('error', (error) => {
    if (connected) events.onError(error as Error)
  })

  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => {
      connected = true
      resolve()
    })
    socket.once('error', (error: Error) => {
      socket.terminate()
      // A handshake rejection arrives as a bare "Unexpected server response:
      // 402", which is a miserable thing to see in the interview room. The
      // status is the whole diagnosis, so name it.
      const status = /Unexpected server response: (\d+)/.exec(error.message)?.[1]
      if (status === '402') {
        reject(
          new Error(
            'Cartesia rejected the connection: the account is out of credit. ' +
              'The key is valid — top it up at https://play.cartesia.ai',
          ),
        )
      } else if (status === '401' || status === '403') {
        reject(new Error(`Cartesia rejected the key (${status}). Check CARTESIA_API_KEY in .env.local`))
      } else {
        reject(error)
      }
    })
  })

  socket.on('message', (raw) => {
    let message: CartesiaMessage
    try {
      message = JSON.parse(raw.toString()) as CartesiaMessage
    } catch {
      return
    }

    const contextId = message.context_id ?? ''
    if (cancelled.has(contextId)) return

    if (message.error) {
      events.onError(new Error(`Cartesia: ${message.error}`))
      return
    }

    if (message.type === 'chunk' && message.data) {
      events.onAudio(Buffer.from(message.data, 'base64'), contextId)
    } else if (message.type === 'done' || message.done) {
      started.delete(contextId)
      events.onDone(contextId)
    }
  })

  const send = (payload: unknown) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
  }

  let characters = 0

  return {
    charactersSpoken: () => characters,

    speak(text, contextId) {
      if (cancelled.has(contextId) || text.trim() === '') return
      characters += text.length
      send({
        model_id: MODEL_ID,
        transcript: text,
        voice: { mode: 'id', id: voiceId },
        output_format: {
          container: 'raw',
          encoding: 'pcm_s16le',
          sample_rate: SAMPLE_RATE,
        },
        context_id: contextId,
        // `continue: true` keeps the utterance open so the next sentence flows
        // on naturally instead of restarting the prosody.
        continue: true,
      })
      started.add(contextId)
    },

    finish(contextId) {
      if (cancelled.has(contextId) || !started.has(contextId)) return
      // An empty transcript with continue:false is Cartesia's end-of-utterance
      // marker; without it the context stays open and never emits `done`.
      send({
        model_id: MODEL_ID,
        transcript: '',
        voice: { mode: 'id', id: voiceId },
        output_format: {
          container: 'raw',
          encoding: 'pcm_s16le',
          sample_rate: SAMPLE_RATE,
        },
        context_id: contextId,
        continue: false,
      })
    },

    cancel(contextId) {
      cancelled.add(contextId)
      started.delete(contextId)
    },

    close() {
      if (socket.readyState === WebSocket.OPEN) socket.close()
    },
  }
}
