/**
 * Microphone capture: browser audio -> 16kHz mono PCM16 frames.
 *
 * Runs as an AudioWorklet, on the audio rendering thread. A ScriptProcessorNode
 * would be simpler but runs on the main thread, so a React re-render or a
 * Pyodide test run would drop microphone frames — and dropped frames upstream of
 * voice activity detection mean missed barge-ins.
 *
 * Served from /public rather than bundled for the same reason as the execution
 * workers: `audioWorklet.addModule` fetches a real URL, and a bundler-rewritten
 * module brings a chunk-loading runtime that has no business on this thread.
 *
 * The browser gives us float32 at the hardware rate (usually 48kHz). Deepgram
 * wants 16-bit signed integers at 16kHz, so this does both conversions here,
 * where the data already is, rather than shipping 3x the bytes to the main
 * thread first.
 */

const TARGET_RATE = 16000
const FRAME_MS = 20
const SAMPLES_PER_FRAME = (TARGET_RATE * FRAME_MS) / 1000 // 320

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buffer = new Float32Array(SAMPLES_PER_FRAME)
    this._filled = 0
    // Fractional read position into the input, advanced by the resample ratio.
    this._position = 0
    this._muted = false

    this.port.onmessage = (event) => {
      if (event.data?.type === 'mute') this._muted = Boolean(event.data.value)
    }
  }

  process(inputs) {
    const channel = inputs[0]?.[0]
    if (!channel || channel.length === 0) return true

    // `sampleRate` is a global in the AudioWorklet scope: the context's real rate.
    const ratio = sampleRate / TARGET_RATE

    // Linear interpolation. Cheap and good enough for speech at this ratio —
    // Deepgram's own guidance is that 16kHz is plenty for recognition, and a
    // proper polyphase filter would cost more CPU than the accuracy is worth.
    while (this._position < channel.length) {
      const index = Math.floor(this._position)
      const fraction = this._position - index
      const current = channel[index]
      const next = index + 1 < channel.length ? channel[index + 1] : current

      this._buffer[this._filled++] = current + (next - current) * fraction
      this._position += ratio

      if (this._filled === SAMPLES_PER_FRAME) {
        this._emit()
        this._filled = 0
      }
    }

    // Carry the fractional remainder into the next render quantum, so the
    // resampler doesn't drift or click at buffer boundaries.
    this._position -= channel.length

    return true
  }

  _emit() {
    if (this._muted) return

    const pcm = new Int16Array(SAMPLES_PER_FRAME)
    for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
      // Clamp before scaling: values slightly outside [-1, 1] are normal after
      // interpolation, and wrapping them would sound like loud clicks.
      const sample = Math.max(-1, Math.min(1, this._buffer[i]))
      pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
    }

    // Transferred, not copied — this runs 50 times a second.
    this.port.postMessage(pcm.buffer, [pcm.buffer])
  }
}

registerProcessor('capture-processor', CaptureProcessor)
