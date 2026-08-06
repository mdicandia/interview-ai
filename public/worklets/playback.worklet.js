/**
 * Interviewer audio playback: queued PCM16 -> the speakers.
 *
 * A ring buffer on the audio thread rather than a chain of AudioBufferSourceNodes.
 * Scheduling one node per arriving chunk means the gaps between them land on
 * whatever the main thread was doing at the time, which is audible as clicks
 * between sentences. A single continuously-pulled buffer has no seams.
 *
 * `flush` is the half of barge-in that lives in the browser, and it is the whole
 * reason this file exists as a worklet. Cancelling on the server only stops new
 * audio being sent: measured against the real pipeline, 41,610 bytes — about 1.3
 * seconds — still arrive after a cancellation. Without dropping those samples
 * here, the interviewer keeps talking over the candidate for that full second.
 */

// Two seconds at the 24kHz playback rate. Large enough to ride out network
// jitter, small enough that a flush never has much to throw away.
//
// Tied to PLAYBACK_SAMPLE_RATE in server/protocol.ts, which this file cannot
// import — worklets are served as plain JS from /public and resolve nothing from
// the build. If that rate changes, change this too, or the buffer silently
// becomes a different number of seconds.
const CAPACITY = 48000

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buffer = new Float32Array(CAPACITY)
    this._read = 0
    this._write = 0
    this._available = 0
    /** True while samples are actually being pulled, for the speaking indicator. */
    this._active = false

    this.port.onmessage = (event) => {
      const message = event.data
      if (message?.type === 'flush') {
        // Reset rather than drain: the point is that this audio is now wrong.
        this._read = 0
        this._write = 0
        this._available = 0
        this._setActive(false)
        return
      }
      if (message?.type === 'pcm') this._enqueue(new Int16Array(message.buffer))
    }
  }

  _enqueue(pcm) {
    for (let i = 0; i < pcm.length; i++) {
      if (this._available === CAPACITY) {
        // Overrun. Dropping the oldest sample keeps latency bounded — the
        // alternative is an ever-growing lag between what the model said and
        // what the candidate hears.
        this._read = (this._read + 1) % CAPACITY
        this._available--
      }
      this._buffer[this._write] = pcm[i] / 0x8000
      this._write = (this._write + 1) % CAPACITY
      this._available++
    }
  }

  _setActive(active) {
    if (this._active === active) return
    this._active = active
    this.port.postMessage({ type: 'active', value: active })
  }

  process(_inputs, outputs) {
    const output = outputs[0]
    const channel = output[0]
    if (!channel) return true

    if (this._available === 0) {
      // Silence, not a stall. Returning false would tear the node down.
      channel.fill(0)
      this._setActive(false)
      return true
    }

    this._setActive(true)

    for (let i = 0; i < channel.length; i++) {
      if (this._available > 0) {
        channel[i] = this._buffer[this._read]
        this._read = (this._read + 1) % CAPACITY
        this._available--
      } else {
        channel[i] = 0
      }
    }

    // Mirror to every other output channel so it isn't only in the left ear.
    for (let c = 1; c < output.length; c++) output[c].set(channel)

    return true
  }
}

registerProcessor('playback-processor', PlaybackProcessor)
