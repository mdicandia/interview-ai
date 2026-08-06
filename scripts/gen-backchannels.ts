/**
 * Pre-generates the interviewer's backchannel clips.
 *
 * Run once; the WAVs are committed. Synthesising these live would defeat the
 * point — the whole reason they exist is that speech synthesis plus DeepSeek is
 * a second and a half from the candidate stopping talking to the first sound
 * coming back, and a clip made at that moment would arrive no sooner than the
 * words it is covering for.
 *
 * **Regenerate whenever the interviewer's voice changes.** These are the same
 * speaker, and a "mm-hm" in one voice followed by a reply in another is worse
 * than no backchannel at all. The generator uses whatever `TTS_PROVIDER`
 * selects, so it stays in step by construction.
 *
 * WAV rather than raw PCM so they can be auditioned. The header is stripped at
 * load time; on the wire they are the same PCM16 as everything else.
 *
 * Run with: pnpm gen:backchannels
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SAMPLE_RATE } from '../server/pipeline/tts'
import { createVoice, selectedTtsProvider } from '../server/pipeline/voice'

/**
 * Receipt tokens only — nothing evaluative.
 *
 * This list is short on purpose and every candidate for it was checked against
 * one question: what does it mean if the candidate has just said something
 * wrong? "Good", "exactly", "makes sense" and "nice" all become an endorsement
 * of a mistake, delivered before the model has even read it. In a tool whose
 * entire job is to tell you when you are wrong, that is worse than silence.
 *
 * What survives only signals that a human is still listening, which is exactly
 * what a real interviewer's "mm-hm" conveys.
 */
const PHRASES: { slug: string; text: string }[] = [
  { slug: 'mm-hm', text: 'Mm-hm.' },
  { slug: 'mm', text: 'Mm.' },
  { slug: 'okay', text: 'Okay.' },
  { slug: 'uh-huh', text: 'Uh-huh.' },
  { slug: 'right', text: 'Right.' },
  { slug: 'okay-so', text: 'Okay, so.' },
]

const OUT_DIR = join(process.cwd(), 'server', 'backchannel')

const DIM_ARROW = '·'

/**
 * Cuts the silence off both ends.
 *
 * The local model pads its output: "Mm-hm." came back as 1.85 seconds, most of
 * it nothing. That is not a cosmetic problem. These clips exist to put a sound
 * in front of the candidate the instant they stop talking, and one that opens
 * with a second of silence covers exactly the gap it was meant to fill while
 * still occupying the speaker when the real reply arrives.
 *
 * The threshold is deliberately low — speech onsets are quiet, and clipping the
 * start of "mm" is worse than leaving a few milliseconds of room tone.
 */
function trimSilence(pcm: Buffer): Buffer {
  const THRESHOLD = 250 // out of 32767; below this is room tone, not speech
  const PADDING = Math.round(SAMPLE_RATE * 0.04) // 40ms, so onsets are not clipped

  const samples = pcm.length / 2
  let first = 0
  let last = samples - 1

  while (first < samples && Math.abs(pcm.readInt16LE(first * 2)) < THRESHOLD) first += 1
  while (last > first && Math.abs(pcm.readInt16LE(last * 2)) < THRESHOLD) last -= 1
  if (first >= last) return pcm

  const start = Math.max(0, first - PADDING)
  const end = Math.min(samples, last + PADDING)
  return pcm.subarray(start * 2, end * 2)
}

/** Canonical 44-byte PCM16 mono header. */
function wavHeader(dataBytes: number): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // PCM chunk size
  header.writeUInt16LE(1, 20) // format: PCM
  header.writeUInt16LE(1, 22) // channels
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36)
  header.writeUInt32LE(dataBytes, 40)
  return header
}

async function main() {
  const key = process.env.CARTESIA_API_KEY
  const provider = selectedTtsProvider()
  if (provider === 'cartesia' && !key) {
    throw new Error('CARTESIA_API_KEY is not set — add it to .env.local')
  }
  console.log(`Generating with the ${provider} voice.\n`)

  mkdirSync(OUT_DIR, { recursive: true })

  for (const { slug, text } of PHRASES) {
    const chunks: Buffer[] = []
    let done = false
    let failure: string | null = null

    const tts = await createVoice(
      {
        onAudio: (pcm) => chunks.push(pcm),
        onDone: () => {
          done = true
        },
        onError: (error) => {
          failure = error.message
          done = true
        },
      },
      key ?? '',
    )

    tts.speak(text, slug)
    tts.finish(slug)

    const deadline = Date.now() + 60_000
    while (!done && Date.now() < deadline) await new Promise((r) => setTimeout(r, 40))
    tts.close()

    if (failure) throw new Error(`${slug}: ${failure}`)

    const raw = Buffer.concat(chunks)
    if (raw.length === 0) throw new Error(`${slug}: no audio came back`)
    const pcm = trimSilence(raw)

    const path = join(OUT_DIR, `${slug}.wav`)
    writeFileSync(path, Buffer.concat([wavHeader(pcm.length), pcm]))
    console.log(
      `  ${slug.padEnd(8)} ${(pcm.length / (SAMPLE_RATE * 2)).toFixed(2)}s` +
        ` ${DIM_ARROW} trimmed from ${(raw.length / (SAMPLE_RATE * 2)).toFixed(2)}s` +
        `  "${text}"`,
    )

    // Serial, not parallel. The local model has one instance and concurrent
    // calls interleave their tensors; the hosted account allows two connections
    // and a live session already holds one. Either way, one at a time.
  }

  console.log(`\n${PHRASES.length} clips written to server/backchannel/`)
  console.log('Audition one with: afplay server/backchannel/mm-hm.wav')
}

void main()
