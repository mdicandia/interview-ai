import type { LLMProvider, Message } from '../pipeline/llm'

/**
 * Decides which of a spoken round's expected points the candidate has reached.
 *
 * **A second model call, deliberately separate from the interviewer.**
 *
 * This used to be a tool — `mark_covered` — on the interviewer itself, and it was
 * unreliable for a structural reason rather than a fixable one. Tools compete
 * with speaking for the model's attention, and every tool added makes the others
 * fire less often: measured in this project, with `run_tests` listed first it
 * fired on 4 turns of 5 while `note_observation` fired on 0. A spoken round had
 * three tools, one of which was this.
 *
 * Splitting it out buys four things:
 *
 * 1. **It can revise.** A fire-and-forget tool call ticks once and can never
 *    reconsider. This re-reads the whole transcript on every pass, so a point
 *    made vaguely at minute 3 and confirmed at minute 9 is caught.
 * 2. **It is off the latency path.** The interviewer runs on `v4-flash` with
 *    thinking disabled and a ~220 token ceiling because a candidate is sitting in
 *    silence waiting for it. Nobody waits for this, so it can read everything.
 * 3. **It gives the interviewer a tool back**, which by the measurement above
 *    should make `conclude_round` and `note_observation` fire more often.
 * 4. **Resume falls out for free.** Coverage is derived from the transcript
 *    rather than accumulated in memory, so a reconnected session recomputes it
 *    from the saved transcript instead of restarting at zero.
 *
 * Cost is not a concern: the points are a frozen prefix and hit DeepSeek's cache,
 * a 15-minute transcript is small, and a pass runs per candidate turn rather than
 * per token.
 */

/** One point the grader believes was reached, with the words that reached it. */
export interface Coverage {
  index: number
  /** The candidate's own words. Not gated on at runtime — see `#apply`. */
  quote: string
}

export interface TranscriptLine {
  role: 'candidate' | 'interviewer'
  text: string
}

export interface GraderConfig {
  llm: LLMProvider
  /** Numbered exactly as the interviewer's prompt numbers them: essential first. */
  points: { text: string; essential: boolean }[]
  /** Called only when the tally actually changes. */
  onChange: (covered: number[]) => void
  /** Quiet time after the last turn before a pass runs. */
  debounceMs?: number
}

/**
 * How long to wait after a turn before grading.
 *
 * Long enough that a candidate finishing a thought in three short bursts is one
 * pass rather than three, short enough that the pips move while they are still
 * on the same subject. Nothing waits on this, so the only cost of being wrong in
 * the slow direction is the tally lagging the conversation.
 */
const DEBOUNCE_MS = 2_500

const RULES = `You are marking a technical interview answer against a fixed list of points. You do not talk to the candidate and they never see your output.

Your only job: decide which numbered points the candidate has actually reached, and quote the words where they reached each one.

How to judge:
- Mark the substance, never the wording. A point reached in clumsy, hesitant, or non-native English is reached. Someone who says "the index is like a separate sorted thing pointing at the rows" has said what a B-tree index is, and it counts.
- Only the candidate's own words count. If the INTERVIEWER states the substance of a point and the candidate only agrees, murmurs, or repeats it back, that point is NOT covered.
- Partial counts as covered only if the core claim is there. A point that names the right mechanism but gets a detail wrong is still covered; a point that only names the topic is not.
- If they say something and then retract it, it is not covered.
- Do not infer. "They clearly know this" is not evidence. If they did not say it, it is not covered.
- A point can be reached anywhere in the transcript, including in passing while answering something else.

Reply with a single JSON object and nothing else:

{"covered": [{"index": 3, "quote": "the exact words from the candidate that reached point 3"}]}

The quote must be the candidate's words, copied from the transcript. Keep it short — one sentence is enough. If nothing is covered, reply {"covered": []}.`

export class CoverageGrader {
  #config: GraderConfig
  #prefix: string

  #timer: ReturnType<typeof setTimeout> | null = null
  #latest: TranscriptLine[] = []
  #running = false
  #dirty = false
  #closed = false
  /** The pass currently running, so `gradeNow` can wait for it to finish. */
  #inFlight: Promise<void> = Promise.resolve()

  /**
   * How many candidate lines the last completed pass saw.
   *
   * A pass over an unchanged transcript can only produce the answer it produced
   * last time, so it is a request nobody needs. The interviewer's own replies
   * do not count: they add no evidence, and grading after every one would double
   * the passes for nothing.
   */
  #gradedLines = -1

  /** Union of every pass. See `#apply` for why this only ever grows. */
  readonly covered = new Set<number>()

  /** The words that earned each tick, for the report and for verification. */
  readonly evidence = new Map<number, string>()

  /** Passes that threw. Surfaced by the verification script, not to the candidate. */
  failures = 0

  constructor(config: GraderConfig) {
    this.#config = config
    this.#prefix = buildGraderPrefix(config.points)
  }

  /**
   * Note the current transcript and schedule a pass.
   *
   * Safe to call on every turn: passes are debounced, coalesced while one is in
   * flight, and skipped entirely when the candidate has said nothing new.
   */
  observe(transcript: TranscriptLine[]): void {
    if (this.#closed) return
    this.#latest = transcript
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => void this.#run(), this.#config.debounceMs ?? DEBOUNCE_MS)
  }

  /**
   * Grade immediately and wait for it. Used on resume, and when the round ends.
   *
   * A pass already in flight was started against an *older* transcript, so
   * joining it is not the same as grading this one. Returning early on that
   * basis is how the reveal at the end of a round came to show the candidate's
   * last answer as missed: the pass it silently waited on had begun before that
   * answer existed. So this waits the running pass out and then grades properly.
   */
  async gradeNow(transcript: TranscriptLine[]): Promise<void> {
    this.#latest = transcript
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    while (this.#running) {
      // We are about to re-run ourselves, so the queued re-run would be a second
      // pass over the same transcript.
      this.#dirty = false
      await this.#inFlight
    }
    await this.#run()
  }

  stop(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
  }

  /**
   * Freezes the tally for good.
   *
   * Called once the round is concluded and the candidate has been shown which
   * points they reached. Anything said after that — a parting remark, a question
   * about the answer — must not move the number, or the history row and the
   * revealed list end up disagreeing about the same round.
   */
  close(): void {
    this.#closed = true
    this.stop()
  }

  /** Sorted, so the browser's pips and the record read in point order. */
  tally(): number[] {
    return [...this.covered].sort((a, b) => a - b)
  }

  async #run(): Promise<void> {
    this.#timer = null

    // One pass at a time. A second one starting mid-flight would grade a
    // transcript the first is already reading, and the two could disagree.
    if (this.#running) {
      this.#dirty = true
      return
    }

    const transcript = this.#latest
    const lines = transcript.filter((line) => line.role === 'candidate').length
    if (lines === 0 || lines === this.#gradedLines) return

    this.#running = true
    // Held so `gradeNow` can wait this pass out rather than joining it.
    this.#inFlight = this.#pass(transcript, lines)
    await this.#inFlight
  }

  async #pass(transcript: TranscriptLine[], lines: number): Promise<void> {
    try {
      const graded = await this.#grade(transcript)
      this.#gradedLines = lines
      this.#apply(graded)
    } catch (error) {
      // A grading failure must never take the round down. The interview is the
      // thing the candidate came for; the tally is bookkeeping around it.
      this.failures += 1
      console.error(`[grader] pass failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.#running = false
      if (this.#dirty && !this.#closed) {
        this.#dirty = false
        void this.#run()
      }
    }
  }

  async #grade(transcript: TranscriptLine[]): Promise<Coverage[]> {
    const messages: Message[] = [
      { role: 'system', content: this.#prefix },
      { role: 'user', content: renderTranscript(transcript) },
    ]

    const raw = await this.#config.llm.complete({
      messages,
      // The fast model, not the report's. Grading is a matching task against a
      // list that is already written down, not a judgement call, and this runs
      // several times a round rather than once at the end.
      fast: true,
      json: true,
      // Room for a quote per point. Too tight and the JSON is truncated, which
      // fails the parse and loses the whole pass rather than the last tick.
      maxTokens: 900,
    })

    return parseCoverage(raw, this.#config.points.length)
  }

  /**
   * Merges a pass into the running tally.
   *
   * **A tick never comes back off, even if a later pass omits it.** Two reasons.
   * The candidate watches these as pips while they talk, and a point going dark
   * mid-answer reads as "you just lost that", which is both wrong and the sort
   * of feedback a practice tool must not give. And the model is asked to judge
   * the same transcript each time, so an omission on pass four is far more likely
   * to be sampling noise than a genuine reconsideration.
   *
   * The cost is that a false positive is permanent for the round. The report is
   * built separately from the transcript and re-judges everything, so it does not
   * inherit the mistake.
   */
  #apply(graded: Coverage[]): void {
    let changed = false
    for (const { index, quote } of graded) {
      if (!this.covered.has(index)) {
        this.covered.add(index)
        changed = true
      }
      // Kept even for an already-ticked point: a later pass usually quotes the
      // clearer of two places the candidate said it.
      if (quote) this.evidence.set(index, quote)
    }
    if (changed) this.#config.onChange(this.tally())
  }
}

/* --------------------------------------------------------------------- prompt */

/**
 * The cached half. Deterministic for a given question, so DeepSeek's prefix cache
 * hits from the second pass of a round onward.
 */
export function buildGraderPrefix(points: { text: string; essential: boolean }[]): string {
  return [
    RULES,
    '',
    '--- THE POINTS ---',
    ...points.map((point, i) => `${i + 1}. ${point.text}${point.essential ? '' : ' (bonus)'}`),
  ].join('\n')
}

/**
 * The transcript, with the speaker named on every line.
 *
 * The labels are load-bearing rather than cosmetic: the rules turn on who said
 * what, and a transcript where the interviewer's summary of a point is
 * indistinguishable from the candidate reaching it would tick almost everything.
 */
function renderTranscript(transcript: TranscriptLine[]): string {
  const lines = transcript.map(
    (line) => `${line.role === 'candidate' ? 'CANDIDATE' : 'INTERVIEWER'}: ${line.text}`,
  )
  return ['--- THE TRANSCRIPT SO FAR ---', '', ...lines].join('\n')
}

/**
 * Reads a grading pass out of the model's raw JSON.
 *
 * Defensive throughout: this is generated text, and a malformed reply must cost
 * one pass rather than the round. An out-of-range index is dropped rather than
 * clamped — a hallucinated point number means nothing was observed, and clamping
 * it would credit the candidate with a point the model never looked at.
 */
export function parseCoverage(raw: string, total: number): Coverage[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw || '{}')
  } catch {
    throw new Error(`grader returned unparseable JSON: ${raw.slice(0, 120)}`)
  }
  if (typeof parsed !== 'object' || parsed === null) return []

  const list = (parsed as { covered?: unknown }).covered
  if (!Array.isArray(list)) return []

  const seen = new Set<number>()
  const coverage: Coverage[] = []
  for (const entry of list) {
    // Both shapes accepted: the schema asks for objects, but a model handed a
    // list of numbers to produce will sometimes just produce the list.
    const index = typeof entry === 'number' ? entry : Number((entry as { index?: unknown })?.index)
    if (!Number.isInteger(index) || index < 1 || index > total || seen.has(index)) continue
    seen.add(index)
    const quote = typeof entry === 'object' && entry !== null ? (entry as { quote?: unknown }).quote : ''
    coverage.push({ index, quote: typeof quote === 'string' ? quote.trim() : '' })
  }
  return coverage
}
