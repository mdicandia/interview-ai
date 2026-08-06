import { KokoroTTS } from 'kokoro-js'
import { PLAYBACK_SAMPLE_RATE } from '../protocol'
import type { TtsClient, TtsEvents } from './tts'

/**
 * Local text-to-speech. No API, no key, no per-character cost.
 *
 * Kokoro is an 82M-parameter Apache-2.0 model that runs on the CPU through
 * onnxruntime-node. It exists here because the hosted alternative bills per
 * character, and a practice tool you use daily should not have a meter running
 * on it — a month's free tier disappeared into a single afternoon of testing.
 *
 * ---------------------------------------------------------------------------
 * Measured on this machine, 2026-08-06, not taken from benchmarks:
 *
 *   dtype       first sentence    throughput
 *   q8               1351ms       1.8x realtime
 *   fp32              664ms       4.0x realtime
 *
 * **fp32 is twice as fast as the quantised build.** That is the opposite of the
 * usual expectation and worth not "optimising" away: int8 has no accelerated
 * kernel on this CPU, so q8 pays dequantisation on every op and wins nothing.
 *
 * Synthesis time is linear in output length at ~235ms per second of audio, and
 * flat across chunk sizes — 1.15s of audio takes 272ms, 5.9s takes 1427ms. So
 * the time to first sound is governed almost entirely by how long the first
 * chunk is, which is why the sentence splitter upstream matters more here than
 * any model tuning would.
 *
 * The honest comparison: Cartesia returns first audio in ~40ms, this takes
 * ~550ms for a typical opening sentence. That is roughly half a second more
 * dead air per turn, traded for never paying per character again. The
 * backchannel clips cover most of it.
 * ---------------------------------------------------------------------------
 *
 * Known cosmetic defect: on exit the process prints
 *
 *   libc++abi: terminating due to uncaught exception of type
 *   std::__1::system_error: mutex lock failed: Invalid argument
 *
 * This is onnxruntime-node tearing down its thread pool after Node has already
 * begun exiting. It happens after every check has run, the exit code is still
 * whatever was set, and calling `model.dispose()` first does not prevent it.
 * Nothing is wrong; do not spend an afternoon on it as I nearly did.
 */

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

/** See the header: fp32 measured 2x faster than q8 on CPU. Do not "optimise". */
const DTYPE = 'fp32'

/**
 * A British male voice, for an unhurried interviewer register.
 *
 * The type is the library's own union of voice ids, so a typo in the env var is
 * caught here rather than at the first spoken sentence of a session. Run
 * `tts.list_voices()` for the full set.
 */
type VoiceId = Parameters<KokoroTTS['generate']>[1] extends { voice?: infer V } ? V : never

const DEFAULT_VOICE = (process.env.KOKORO_VOICE ?? 'bm_george') as NonNullable<VoiceId>

/**
 * One model for the whole process, loaded once.
 *
 * A cold load is ~17s — mostly reading 330MB of weights off disk. Doing that per
 * session would put it squarely in front of the candidate pressing "Start
 * interview". Kicked off at import time so it is usually finished before anyone
 * asks for it, and awaited rather than re-entered if it is not.
 */
let loading: Promise<KokoroTTS> | null = null

export function preloadKokoro(): Promise<KokoroTTS> {
  loading ??= KokoroTTS.from_pretrained(MODEL_ID, { dtype: DTYPE, device: 'cpu' })
  return loading
}

interface Job {
  text: string
  contextId: string
}

/**
 * Converts float samples to the PCM16 the browser's playback worklet expects.
 *
 * No resampling: Kokoro emits 24kHz and the playback half of the pipeline runs
 * at 24kHz for exactly that reason. See `PLAYBACK_SAMPLE_RATE`.
 */
function toPcm16(samples: Float32Array): Buffer {
  const pcm = Buffer.allocUnsafe(samples.length * 2)
  for (let i = 0; i < samples.length; i += 1) {
    // Clamp before scaling. Values slightly outside [-1, 1] are normal from a
    // vocoder, and wrapping them is an extremely loud click.
    const sample = Math.max(-1, Math.min(1, samples[i]))
    pcm.writeInt16LE(Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), i * 2)
  }
  return pcm
}

export async function createKokoroTtsClient(events: TtsEvents): Promise<TtsClient> {
  const model = await preloadKokoro()

  const queue: Job[] = []
  /** Contexts abandoned by barge-in; queued and in-flight work for them is dropped. */
  const cancelled = new Set<string>()
  /** Contexts told no more text is coming, so the queue draining means done. */
  const finished = new Set<string>()
  let characters = 0
  let running = false
  let closed = false

  /**
   * Drains the queue one job at a time.
   *
   * Strictly serial because there is a single model instance and concurrent
   * `generate` calls on it interleave their tensors. Serialising costs nothing
   * real: synthesis runs at ~4x realtime, so the queue drains faster than the
   * audio already sent can play.
   */
  async function pump(): Promise<void> {
    if (running) return
    running = true

    try {
      while (queue.length > 0 && !closed) {
        const job = queue.shift()!
        if (cancelled.has(job.contextId)) continue

        try {
          const audio = await model.generate(job.text, { voice: DEFAULT_VOICE })
          // Re-checked after the await: a barge-in during synthesis is exactly
          // the case this exists for, and the samples are now wrong.
          if (cancelled.has(job.contextId) || closed) continue
          events.onAudio(toPcm16(audio.audio as Float32Array), job.contextId)
        } catch (error) {
          events.onError(error instanceof Error ? error : new Error(String(error)))
        }

        // Done only once nothing further is queued for this context *and* the
        // caller has said it is finished. Firing on an empty queue alone would
        // end the turn between two sentences of the same reply.
        const pending = queue.some((next) => next.contextId === job.contextId)
        if (!pending && finished.has(job.contextId) && !cancelled.has(job.contextId)) {
          finished.delete(job.contextId)
          events.onDone(job.contextId)
        }
      }
    } finally {
      running = false
    }
  }

  return {
    charactersSpoken: () => characters,

    speak(text, contextId) {
      if (cancelled.has(contextId) || closed || text.trim() === '') return
      characters += text.length
      queue.push({ text, contextId })
      void pump()
    },

    finish(contextId) {
      if (cancelled.has(contextId) || closed) return
      finished.add(contextId)
      // Nothing queued means the last sentence already went out and its `done`
      // was skipped because `finish` had not been called yet.
      if (!queue.some((job) => job.contextId === contextId) && !running) {
        finished.delete(contextId)
        events.onDone(contextId)
      } else {
        void pump()
      }
    },

    cancel(contextId) {
      cancelled.add(contextId)
      finished.delete(contextId)
      // Splice rather than filter-reassign: `pump` holds a reference to this
      // array and is very likely mid-loop right now.
      for (let i = queue.length - 1; i >= 0; i -= 1) {
        if (queue[i].contextId === contextId) queue.splice(i, 1)
      }
    },

    close() {
      closed = true
      queue.length = 0
    },
  }
}

export const KOKORO_SAMPLE_RATE = PLAYBACK_SAMPLE_RATE
