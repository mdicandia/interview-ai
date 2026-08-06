import WebSocket from 'ws'

/**
 * Deepgram streaming speech-to-text.
 *
 * This does more than transcribe — it also drives turn-taking, which is most of
 * what makes a voice conversation feel like a conversation rather than a
 * walkie-talkie. Two signals matter:
 *
 * - `SpeechStarted` (voice activity) fires the moment the candidate begins
 *   talking. That is the barge-in trigger: if the interviewer is mid-sentence,
 *   it must stop immediately.
 * - endpointing / `UtteranceEnd` fires when they have *finished a thought*,
 *   not merely paused. That is what decides when the interviewer may reply.
 *   Get it wrong and it either interrupts constantly or sits in silence.
 *
 * Both come from Deepgram's stream, which is why it earns a separate vendor
 * rather than folding STT in with the TTS provider.
 */

const DEEPGRAM_WS = 'wss://api.deepgram.com/v1/listen'

export const SAMPLE_RATE = 16_000

/**
 * Milliseconds of silence before Deepgram calls a transcript final.
 *
 * 300ms is the usual starting point. Lower and it cuts people off mid-sentence
 * when they pause to think — which for a candidate reasoning aloud is constant.
 * Higher and every reply feels laggy. Worth tuning by ear once the loop runs.
 */
const ENDPOINTING_MS = 300

/**
 * Silence after the last word before declaring the turn over. Deliberately
 * longer than endpointing: a candidate saying "so... if I use a map here" should
 * not lose the floor during that pause.
 */
const UTTERANCE_END_MS = 1_000

export interface SttEvents {
  /** Voice detected. Barge-in trigger — fires before any transcript exists. */
  onSpeechStarted: () => void
  /** Best-guess text so far. Useful for on-screen feedback, not for decisions. */
  onInterim: (text: string) => void
  /** A settled chunk of transcript. A turn may contain several. */
  onFinal: (text: string) => void
  /** The candidate has stopped talking; the interviewer may now respond. */
  onUtteranceEnd: () => void
  onError: (error: Error) => void
  onClose: () => void
}

export interface SttClient {
  /** Feed raw PCM16 at SAMPLE_RATE from the browser. */
  send(pcm: Buffer): void
  /** Flush and close cleanly, so trailing audio still gets transcribed. */
  close(): void
}

interface DeepgramMessage {
  type?: string
  channel?: { alternatives?: { transcript?: string }[] }
  is_final?: boolean
  speech_final?: boolean
  error?: string
  description?: string
}

export async function createSttClient(apiKey: string, events: SttEvents): Promise<SttClient> {
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY is not set — add it to .env.local')

  const params = new URLSearchParams({
    model: 'nova-3',
    encoding: 'linear16',
    sample_rate: String(SAMPLE_RATE),
    channels: '1',
    // Required for utterance_end_ms to work at all, and gives live feedback.
    interim_results: 'true',
    endpointing: String(ENDPOINTING_MS),
    utterance_end_ms: String(UTTERANCE_END_MS),
    // Without this there is no SpeechStarted event, and so no barge-in.
    vad_events: 'true',
    punctuate: 'true',
    smart_format: 'true',
  })

  const socket = new WebSocket(`${DEEPGRAM_WS}?${params}`, {
    headers: { Authorization: `Token ${apiKey}` },
  })

  // Attached before the handshake is awaited. A failed handshake emits `error`
  // twice — once for the rejection, once as the socket tears down — and the
  // second has no listener if the only one is the `once` below. An unhandled
  // 'error' event is a hard process crash, so one bad connection would take the
  // whole voice server with it rather than failing a single session.
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
      const status = /Unexpected server response: (\d+)/.exec(error.message)?.[1]
      reject(
        status === '401' || status === '403'
          ? new Error(`Deepgram rejected the key (${status}). Check DEEPGRAM_API_KEY in .env.local`)
          : status === '402'
            ? new Error(
                'Deepgram rejected the connection: the account is out of credit. ' +
                  'The key is valid — top it up at https://console.deepgram.com',
              )
            : error,
      )
    })
  })

  socket.on('message', (raw) => {
    let message: DeepgramMessage
    try {
      message = JSON.parse(raw.toString()) as DeepgramMessage
    } catch {
      return
    }

    if (message.error || message.type === 'Error') {
      events.onError(new Error(`Deepgram: ${message.error ?? message.description ?? 'unknown'}`))
      return
    }

    switch (message.type) {
      case 'SpeechStarted':
        events.onSpeechStarted()
        break

      case 'UtteranceEnd':
        events.onUtteranceEnd()
        break

      case 'Results': {
        const text = message.channel?.alternatives?.[0]?.transcript ?? ''
        if (text.trim() === '') break
        if (message.is_final) {
          events.onFinal(text)
          // `speech_final` means Deepgram's own endpointing decided the speaker
          // stopped. It arrives sooner than UtteranceEnd, so acting on it keeps
          // replies snappy; UtteranceEnd remains the backstop for the case where
          // trailing silence never produces a final result.
          if (message.speech_final) events.onUtteranceEnd()
        } else {
          events.onInterim(text)
        }
        break
      }
    }
  })

  socket.on('close', () => events.onClose())

  return {
    send(pcm) {
      if (socket.readyState === WebSocket.OPEN) socket.send(pcm)
    },
    close() {
      if (socket.readyState === WebSocket.OPEN) {
        // Deepgram transcribes any buffered audio before closing when told this
        // way; a bare socket.close() can drop the last word of a sentence.
        socket.send(JSON.stringify({ type: 'CloseStream' }))
      }
    },
  }
}
