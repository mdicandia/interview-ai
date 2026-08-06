/**
 * Pre-generates the interviewer's backchannel clips.
 *
 * Run once; the WAVs are committed. Synthesising these live would defeat the
 * point — the whole reason they exist is that Cartesia plus DeepSeek is about a
 * second and a half from the candidate stopping talking to the first sound
 * coming back, and a clip fetched at that moment would arrive no sooner than the
 * words it is covering for.
 *
 * WAV rather than raw PCM so they can be auditioned. The header is stripped at
 * load time; on the wire they are the same 16kHz mono PCM16 as everything else.
 *
 * Run with: pnpm gen:backchannels
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTtsClient, SAMPLE_RATE } from '../server/pipeline/tts'

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
  if (!key) throw new Error('CARTESIA_API_KEY is not set — add it to .env.local')

  mkdirSync(OUT_DIR, { recursive: true })

  for (const { slug, text } of PHRASES) {
    const chunks: Buffer[] = []
    let done = false
    let failure: string | null = null

    const tts = await createTtsClient(key, {
      onAudio: (pcm) => chunks.push(pcm),
      onDone: () => {
        done = true
      },
      onError: (error) => {
        failure = error.message
        done = true
      },
    })

    tts.speak(text, slug)
    tts.finish(slug)

    const deadline = Date.now() + 25_000
    while (!done && Date.now() < deadline) await new Promise((r) => setTimeout(r, 40))
    tts.close()

    if (failure) throw new Error(`${slug}: ${failure}`)

    const pcm = Buffer.concat(chunks)
    if (pcm.length === 0) throw new Error(`${slug}: no audio came back`)

    const path = join(OUT_DIR, `${slug}.wav`)
    writeFileSync(path, Buffer.concat([wavHeader(pcm.length), pcm]))
    console.log(
      `  ${slug.padEnd(8)} ${(pcm.length / (SAMPLE_RATE * 2)).toFixed(2)}s  "${text}"  → ${path}`,
    )

    // Serial, not parallel: the account allows two concurrent Cartesia
    // connections and a live session already holds one.
  }

  console.log(`\n${PHRASES.length} clips written to server/backchannel/`)
  console.log('Audition one with: afplay server/backchannel/mm-hm.wav')
}

void main()
