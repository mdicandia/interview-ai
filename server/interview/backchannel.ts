import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SAMPLE_RATE } from '../pipeline/tts'

/**
 * The "mm-hm" that covers the gap while the model thinks.
 *
 * Measured end to end, the candidate stops talking and roughly a second and a
 * half passes before the first syllable comes back: ~300ms for endpointing, then
 * ~1100ms for DeepSeek's first token, then ~40ms for Cartesia. Under a second
 * feels like conversation; a second and a half of dead air feels like a dropped
 * call, and the instinct is to repeat yourself into it.
 *
 * A pre-generated clip fires the moment endpointing does, so something human
 * happens immediately while the real reply is still being written. The clips are
 * committed rather than synthesised on demand — a clip fetched at the moment it
 * is needed would arrive no sooner than the words it exists to cover.
 *
 * Deliberately not on every turn. An interviewer who acknowledges every single
 * utterance sounds like a call-centre script, and a pause before a hard follow-up
 * is in character rather than a defect — that silence is the interviewer
 * thinking, which is exactly what is happening.
 */

/** How often a turn gets one. The rest keep their natural pause. */
const PLAY_PROBABILITY = 0.7

export interface Backchannel {
  /** A clip to play now, or null when this turn should keep its silence. */
  next(): Buffer | null
  readonly size: number
}

/**
 * Extracts PCM from a canonical WAV.
 *
 * Walks the chunk table rather than assuming a 44-byte header: encoders are
 * entitled to insert `LIST` or `fact` chunks before `data`, and slicing at a
 * fixed offset would feed those bytes to the speaker as a burst of noise.
 */
function pcmFromWav(wav: Buffer): Buffer {
  if (wav.length < 12 || wav.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('not a RIFF file')
  }
  let offset = 12
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    if (id === 'data') return wav.subarray(offset + 8, Math.min(offset + 8 + size, wav.length))
    // Chunks are word-aligned, so an odd size is followed by a pad byte.
    offset += 8 + size + (size % 2)
  }
  throw new Error('no data chunk')
}

/**
 * Loads the clips once, at server start.
 *
 * Never throws: a missing or corrupt clip directory must not stop an interview.
 * The pipeline works without backchannels — it is just less comfortable — so a
 * failure here degrades to the plain 1.5s pause rather than taking the session
 * down with it.
 */
const DEFAULT_DIR = join(process.cwd(), 'server', 'backchannel')

/**
 * Decoded clips, cached per directory.
 *
 * The audio is immutable and identical for every session, so reading and parsing
 * it again on each `new InterviewSession` would be blocking disk I/O on the path
 * that starts an interview, for bytes we already have.
 */
const cache = new Map<string, Buffer[]>()

function clipsIn(directory: string): Buffer[] {
  const cached = cache.get(directory)
  if (cached) return cached

  const clips: Buffer[] = []
  try {
    for (const file of readdirSync(directory).filter((f) => f.endsWith('.wav')).sort()) {
      try {
        const pcm = pcmFromWav(readFileSync(join(directory, file)))
        // Anything long enough to still be playing when the real reply starts is
        // worse than nothing: the two would queue up and the interviewer would
        // say "mm-hm" and then talk over its own acknowledgement.
        if (pcm.length > 0 && pcm.length < SAMPLE_RATE * 2 * 1.6) clips.push(pcm)
      } catch {
        // One bad clip should not cost the others.
      }
    }
  } catch {
    // No directory. Run `pnpm gen:backchannels` to create it.
  }

  cache.set(directory, clips)
  return clips
}

export function loadBackchannels(
  directory = DEFAULT_DIR,
  random: () => number = Math.random,
): Backchannel {
  const clips = clipsIn(directory)
  let last = -1

  return {
    size: clips.length,
    next() {
      if (clips.length === 0) return null
      if (random() > PLAY_PROBABILITY) return null
      if (clips.length === 1) return clips[0]

      // Never the same one twice running. Hearing "mm-hm, mm-hm" back to back is
      // more obviously synthetic than saying nothing would have been.
      let index = Math.floor(random() * clips.length)
      if (index === last) index = (index + 1) % clips.length
      last = index
      return clips[index]
    },
  }
}
