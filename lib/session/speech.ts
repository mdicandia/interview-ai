import type { TranscriptLine } from './record'

/**
 * What can be counted about how someone spoke, rather than judged.
 *
 * The report's delivery axis is model-judged prose, and prose is the right shape
 * for most of it — "you dismissed the pushback without engaging with it" is not a
 * number. But several of the things that have actually cost interviews *are*
 * numbers, and a number behaves differently: it can be trended, it cannot flatter
 * you, and it says how far you have to move rather than only which way.
 *
 * Every function here is pure and takes the same input — the timestamped
 * transcript the evidence record already stores. No model, no I/O, no React. That
 * is deliberate: it makes the whole file testable offline in milliseconds, which
 * is what keeps these honest.
 *
 * **Two clocks, and using the wrong one is the trap.** `at` is when a line
 * arrived, which includes the speech model's latency and the endpointing window —
 * a property of the pipeline, not the speaker. `start` and `spokenSeconds` are
 * positions in the audio. Anything about *pace* or *silence* must use the second
 * pair, and returns null when they are absent rather than guessing: rounds
 * recorded before those existed are unmeasurable, not zero.
 */

export interface SpeechMetrics {
  /** Seconds the candidate actually spoke. Null when the round has no timings. */
  spokenSeconds: number | null
  /** Words per minute while speaking. Null without timings. */
  wordsPerMinute: number | null
  /**
   * Candidate speech as a fraction of the round, 0–1.
   *
   * The number behind the most-repeated piece of live-coding advice there is:
   * solving it in silence can still be a no. Null without timings.
   */
  talkTimeRatio: number | null
  /** The longest gap between candidate lines, and where it started. */
  longestSilence: { seconds: number; atSecond: number } | null
  /** Seconds from the round opening to the candidate's first word. */
  timeToFirstWord: number | null
  /**
   * First-person singular as a fraction of all first-person use, 0–1.
   *
   * Lower means more "we" than "I". Null when the candidate used neither, which
   * is itself worth knowing and is not the same as a zero.
   */
  agencyRatio: number | null
  /** Raw counts behind the ratio, because the ratio alone hides the sample size. */
  firstPersonSingular: number
  firstPersonPlural: number
  /** Hedges and fillers per minute of speech. Null without timings. */
  hedgesPerMinute: number | null
  fillersPerMinute: number | null
  hedgeCount: number
  fillerCount: number
  words: number
}

/**
 * Words that claim the work, and words that share it.
 *
 * "We" is not wrong — most engineering is collective and claiming a team's work
 * is its own failure mode. What an interviewer listens for is whether the *own*
 * contribution ever surfaces, and someone who says "we" ninety times and "I"
 * twice has usually not told them what they did. The ratio is a prompt to listen
 * to the recording, not a verdict.
 */
const SINGULAR = /\b(i|i'm|i've|i'd|i'll|me|my|mine|myself)\b/g
const PLURAL = /\b(we|we're|we've|we'd|we'll|us|our|ours|ourselves)\b/g

/** Softeners that make a correct answer sound like a guess. */
const HEDGES =
  /\b(i think|i guess|i believe|maybe|perhaps|probably|sort of|kind of|a bit|somewhat|i'm not sure|not really sure|or something|i would say)\b/g

/**
 * Disfluencies, kept only because the speech client asks for them.
 *
 * Deepgram strips these by default; see the `filler_words` note in stt.ts. If it
 * ever stops honouring that, this counts zero for everyone and looks like a
 * metric that works — which is why `fillersPerMinute` is reported beside the raw
 * count rather than alone.
 */
const FILLERS = /\b(um|uh|erm|ah|hmm|mm|like|you know|basically|actually|literally|genuinely)\b/g

const WORD = /[\p{L}\p{N}'’-]+/gu

function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length
}

/** Lowercased, with curly apostrophes folded so the patterns above match both. */
function normalise(lines: TranscriptLine[]): string {
  return lines
    .map((line) => line.text)
    .join(' ')
    .toLowerCase()
    .replace(/’/g, "'")
}

const candidateLines = (transcript: TranscriptLine[]) =>
  transcript.filter((line) => line.role === 'candidate')

/** True when the round carries speech timings at all. */
function timed(lines: TranscriptLine[]): boolean {
  return lines.some((line) => typeof line.spokenSeconds === 'number')
}

export function speechMetrics(
  transcript: TranscriptLine[],
  /** Round length in ms, for the talk-time ratio. */
  elapsedMs: number,
): SpeechMetrics {
  const said = candidateLines(transcript)
  const text = normalise(said)
  const words = count(text, WORD)

  const firstPersonSingular = count(text, SINGULAR)
  const firstPersonPlural = count(text, PLURAL)
  const firstPerson = firstPersonSingular + firstPersonPlural

  const hedgeCount = count(text, HEDGES)
  const fillerCount = count(text, FILLERS)

  const hasTimings = timed(said)
  const spokenSeconds = hasTimings
    ? said.reduce((total, line) => total + (line.spokenSeconds ?? 0), 0)
    : null

  const perMinute = (n: number) =>
    spokenSeconds === null || spokenSeconds <= 0 ? null : n / (spokenSeconds / 60)

  return {
    spokenSeconds,
    wordsPerMinute: perMinute(words),
    talkTimeRatio:
      spokenSeconds === null || elapsedMs <= 0
        ? null
        : Math.min(1, spokenSeconds / (elapsedMs / 1000)),
    longestSilence: longestSilence(said),
    timeToFirstWord: hasTimings ? (said[0]?.start ?? null) : null,
    agencyRatio: firstPerson === 0 ? null : firstPersonSingular / firstPerson,
    firstPersonSingular,
    firstPersonPlural,
    hedgesPerMinute: perMinute(hedgeCount),
    fillersPerMinute: perMinute(fillerCount),
    hedgeCount,
    fillerCount,
    words,
  }
}

/**
 * The longest gap between one line ending and the next beginning.
 *
 * Approximate on purpose, and the approximation is worth naming: endpointing
 * closes a segment after 300ms of quiet, so a genuine pause is reported slightly
 * long and two sentences run together are reported as one. It is accurate enough
 * to find the four-minute hole where someone went away and coded in silence,
 * which is the only thing anyone looks at this for.
 */
function longestSilence(said: TranscriptLine[]): { seconds: number; atSecond: number } | null {
  if (!timed(said)) return null

  let longest: { seconds: number; atSecond: number } | null = null
  for (let i = 1; i < said.length; i += 1) {
    const previous = said[i - 1]
    const current = said[i]
    if (previous.start === undefined || current.start === undefined) continue
    const endedAt = previous.start + (previous.spokenSeconds ?? 0)
    const gap = current.start - endedAt
    if (gap > 0 && (longest === null || gap > longest.seconds)) {
      longest = { seconds: gap, atSecond: endedAt }
    }
  }
  return longest
}

/**
 * Does the last thing said land on an outcome?
 *
 * The named failure is *estirar historias sin final* — stretching a story with no
 * ending. An answer that finishes on a number, a shipped thing, or a permanent
 * change has landed; one that trails off on a document, a process or a feeling
 * has not.
 *
 * Deliberately generous, and only ever used to *raise* a question rather than to
 * score. A false "no ending" on an answer that ended fine is a wasted minute of
 * re-listening; a false "ended well" teaches the wrong habit.
 */
const OUTCOME = /\b(\d+%|\d+x|[$€£]\d+|\d[\d,.]*\s*(ms|seconds?|minutes?|hours?|days?|weeks?|users?|customers?|requests?|times)|shipped|launched|released|merged|adopted|reduced|cut|saved|grew|doubled|halved|fixed|resolved|unblocked|still (?:use|uses|used|running|in place)|since then|to this day)\b/

export function endsOnAnOutcome(transcript: TranscriptLine[]): boolean | null {
  const said = candidateLines(transcript)
  if (said.length === 0) return null
  // The last two lines, because endpointing splits a closing sentence as often
  // as not, and judging the final fragment alone would be judging the split.
  const ending = said
    .slice(-2)
    .map((line) => line.text)
    .join(' ')
    .toLowerCase()
  return OUTCOME.test(ending)
}
