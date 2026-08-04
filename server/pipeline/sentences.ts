/**
 * Splits a token stream into speakable sentences.
 *
 * Without this, TTS can't start until the model stops generating, so the wait
 * is first-token latency *plus* the whole generation. Emitting each sentence as
 * it completes means the candidate hears the first one while the rest is still
 * being written — and since the interviewer speaks in one or two sentences, the
 * second one is usually ready before the first finishes playing.
 *
 * Deliberately not a general-purpose sentence tokeniser. It only has to be right
 * for short spoken interviewer replies, and the failure mode that matters is
 * splitting mid-abbreviation ("O(n) vs. O(n log n)") and producing an awkward
 * pause. Over-splitting is worse than under-splitting here.
 */

/** Terminators that end a spoken sentence. */
const TERMINATORS = new Set(['.', '!', '?'])

/**
 * Lower-cased tokens that end in a period but do not end a sentence. Short,
 * because every entry is a guess about what an interviewer might say.
 */
const ABBREVIATIONS = new Set([
  'e.g.',
  'i.e.',
  'etc.',
  'vs.',
  'approx.',
  'fig.',
  'mr.',
  'ms.',
  'dr.',
])

/**
 * Don't emit a fragment shorter than this. A stray "Right." would otherwise
 * become its own TTS request, and the per-request overhead costs more than
 * simply speaking it together with what follows.
 */
const MIN_SENTENCE_CHARS = 12

function endsWithAbbreviation(text: string): boolean {
  const match = text.trimEnd().match(/(\S+)$/)
  if (!match) return false
  const word = match[1].toLowerCase()
  if (ABBREVIATIONS.has(word)) return true
  // A single capital followed by a dot is an initial ("H." in "H. Smith"), and
  // a decimal point inside a number is not a sentence end either.
  return /^[a-z]\.$/i.test(word) || /\d\.$/.test(word)
}

/**
 * Accumulates deltas and yields complete sentences as they form.
 *
 * Stateful on purpose: a terminator often arrives in a different chunk from the
 * text before it, so the decision can't be made per-delta.
 */
export class SentenceSplitter {
  #buffer = ''

  /** Feed one delta; returns any sentences that just became complete. */
  push(delta: string): string[] {
    this.#buffer += delta
    const out: string[] = []

    let index = 0
    while (index < this.#buffer.length) {
      const char = this.#buffer[index]

      if (TERMINATORS.has(char)) {
        // Absorb a run of terminators and any closing quote or bracket, so
        // `?"` and `!!` stay attached to the sentence they belong to.
        let end = index + 1
        while (end < this.#buffer.length && /[.!?"')\]]/.test(this.#buffer[end])) end++

        // A terminator at the very end of the buffer might still be mid-word
        // (an abbreviation, or an ellipsis still arriving) — wait for more.
        const atBufferEnd = end >= this.#buffer.length
        const candidate = this.#buffer.slice(0, end)

        if (!atBufferEnd && !endsWithAbbreviation(candidate.slice(0, index + 1))) {
          const sentence = candidate.trim()
          if (sentence.length >= MIN_SENTENCE_CHARS) {
            out.push(sentence)
            this.#buffer = this.#buffer.slice(end)
            index = 0
            continue
          }
        }
        index = end
        continue
      }

      index++
    }

    return out
  }

  /** Whatever is left when the stream ends — usually the final sentence. */
  flush(): string | null {
    const remaining = this.#buffer.trim()
    this.#buffer = ''
    return remaining.length > 0 ? remaining : null
  }
}

/** Convenience wrapper: turns a delta stream into a sentence stream. */
export async function* toSentences(deltas: AsyncIterable<string>): AsyncGenerator<string> {
  const splitter = new SentenceSplitter()
  for await (const delta of deltas) {
    for (const sentence of splitter.push(delta)) yield sentence
  }
  const tail = splitter.flush()
  if (tail) yield tail
}
