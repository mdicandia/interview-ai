'use client'

/**
 * Main-thread wiring for the two audio worklets.
 *
 * One AudioContext at 16kHz drives both: the browser resamples the microphone
 * into it and the speakers out of it, so nothing downstream has to know the
 * hardware rate. Requesting the context at the target rate is also the one place
 * where the resampling is free.
 */

const CAPTURE_MODULE = '/worklets/capture.worklet.js'
const PLAYBACK_MODULE = '/worklets/playback.worklet.js'

export const SAMPLE_RATE = 16_000

export interface AudioSessionEvents {
  /** A 20ms PCM16 frame from the microphone, ready for the wire. */
  onFrame: (pcm: ArrayBuffer) => void
  /** Whether the interviewer's audio is actually playing right now. */
  onSpeakingChange?: (speaking: boolean) => void
}

export class AudioSession {
  #context: AudioContext | null = null
  #stream: MediaStream | null = null
  #capture: AudioWorkletNode | null = null
  #playback: AudioWorkletNode | null = null
  #events: AudioSessionEvents

  constructor(events: AudioSessionEvents) {
    this.#events = events
  }

  /**
   * Asks for the microphone and starts both worklets.
   *
   * Must be called from a user gesture: browsers block both microphone access
   * and AudioContext start-up otherwise, and an AudioContext created outside one
   * begins suspended with no obvious symptom beyond total silence.
   */
  async start(): Promise<void> {
    if (this.#context) return

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        // The browser's own processing is worth having here — it is tuned for
        // exactly this case, and echo cancellation is what stops the interviewer
        // hearing itself through the speakers and interrupting its own sentence.
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    this.#stream = stream

    const context = new AudioContext({ sampleRate: SAMPLE_RATE })
    this.#context = context
    // Safari in particular hands back a suspended context even from a gesture.
    if (context.state === 'suspended') await context.resume()

    await context.audioWorklet.addModule(CAPTURE_MODULE)
    await context.audioWorklet.addModule(PLAYBACK_MODULE)

    const source = context.createMediaStreamSource(stream)
    const capture = new AudioWorkletNode(context, 'capture-processor')
    capture.port.onmessage = (event) => this.#events.onFrame(event.data as ArrayBuffer)
    source.connect(capture)
    // The capture node produces no output, but an unconnected node can be
    // garbage-collected mid-session in some browsers. A zero-gain sink keeps it
    // alive without anything being audible.
    const sink = context.createGain()
    sink.gain.value = 0
    capture.connect(sink).connect(context.destination)
    this.#capture = capture

    const playback = new AudioWorkletNode(context, 'playback-processor', {
      outputChannelCount: [1],
    })
    playback.port.onmessage = (event) => {
      const message = event.data as { type?: string; value?: boolean }
      if (message?.type === 'active') this.#events.onSpeakingChange?.(Boolean(message.value))
    }
    playback.connect(context.destination)
    this.#playback = playback
  }

  /** Queue interviewer audio for playback. */
  play(pcm: ArrayBuffer): void {
    this.#playback?.port.postMessage({ type: 'pcm', buffer: pcm }, [pcm])
  }

  /**
   * Barge-in: discard everything buffered, immediately.
   *
   * See the worklet comment — roughly 1.3 seconds of audio is typically already
   * queued when the server cancels, and this is the only thing that stops it.
   */
  flush(): void {
    this.#playback?.port.postMessage({ type: 'flush' })
  }

  /** Stop sending frames without tearing down the graph. */
  setMuted(muted: boolean): void {
    this.#capture?.port.postMessage({ type: 'mute', value: muted })
  }

  async stop(): Promise<void> {
    this.#capture?.disconnect()
    this.#playback?.disconnect()
    for (const track of this.#stream?.getTracks() ?? []) track.stop()
    await this.#context?.close()
    this.#context = null
    this.#stream = null
    this.#capture = null
    this.#playback = null
  }
}
