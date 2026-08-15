/**
 * Proves the coverage grader marks substance rather than fluency.
 *
 * This is the check the whole design exists for. The tool it replaced was
 * unreliable in a way that could not be tested — whether a tool fires at all is
 * the model's discretion, and it varied run to run. A separate call reading a
 * fixed transcript is deterministic enough to assert on, and the assertions are
 * the ones that matter to whoever practises with this:
 *
 *   A. A competent answer in plain English gets its points.
 *   B. **The same answer in halting, non-native English gets exactly the same
 *      points.** If this ever regresses, the tool has started grading language
 *      instead of knowledge, which is the one thing it must never do.
 *   C. Points the INTERVIEWER supplies do not count, and neither does something
 *      the candidate retracts.
 *   D. Quotes are real. A tick with an invented quote is a tick with no evidence.
 *
 * The first half runs against a stub and needs no network: debouncing,
 * coalescing, the monotonic tally, and surviving malformed JSON. The second half
 * calls the real API, because "did it understand what they meant" is exactly the
 * part a stub cannot answer.
 *
 * Run with: pnpm verify:grader
 */

import { conceptDatabaseIndex } from '../questions/concepts'
import { CoverageGrader, parseCoverage, type TranscriptLine } from '../server/interview/grader'
import { createDeepSeekProvider } from '../server/pipeline/llm'
import type { LLMProvider } from '../server/pipeline/llm'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

let failures = 0
function check(ok: boolean, label: string, detail = '') {
  if (ok) console.log(`  ${GREEN}✓${RESET} ${label}${detail ? ` ${DIM}${detail}${RESET}` : ''}`)
  else {
    failures += 1
    console.log(`  ${RED}✗${RESET} ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * The points, numbered exactly as the orchestrator numbers them: essential
 * first. The numbering is the contract between the prompt and the tally, so the
 * verifier must not invent its own.
 */
const POINTS = [
  ...conceptDatabaseIndex.expectedPoints.filter((p) => p.essential),
  ...conceptDatabaseIndex.expectedPoints.filter((p) => !p.essential),
].map((p) => ({ text: p.point, essential: p.essential === true }))

/** 1 = what an index is, 2 = reads get faster, 3 = writes get slower, 4 = disk space. */
const STRUCTURE = 1
const READS = 2
const WRITES = 3
const DISK = 4

function grader(llm: LLMProvider, debounceMs = 20) {
  const changes: number[][] = []
  const instance = new CoverageGrader({
    llm,
    points: POINTS,
    debounceMs,
    onChange: (covered) => changes.push(covered),
  })
  return { instance, changes }
}

/** Replays one canned JSON reply per `complete()` call, and counts the calls. */
function stubLLM(
  replies: string[],
  delayMs = 5,
): LLMProvider & { used: () => number; started: () => Promise<void> } {
  let index = 0
  let markStarted!: () => void
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  return {
    name: 'stub',
    used: () => index,
    /** Resolves once a pass is genuinely in flight, so no test has to guess. */
    started: () => started,
    async stream() {
      throw new Error('the grader must never use the streaming path')
    },
    async complete() {
      markStarted()
      const reply = replies[index] ?? '{"covered":[]}'
      index += 1
      await sleep(delayMs)
      return reply
    },
  }
}

const says = (text: string): TranscriptLine => ({ role: 'candidate', text })
const asks = (text: string): TranscriptLine => ({ role: 'interviewer', text })

/* ------------------------------------------------------------------ the answers
 *
 * A and B carry the same three points and differ only in how they are said. B is
 * written the way a fluent Spanish speaker actually sounds when thinking out loud
 * in English, including the filler and the self-repair — and with two words
 * mangled the way Deepgram mangles them.
 */

const CLEAR: TranscriptLine[] = [
  asks('You add an index to a column on a large table. What actually changes?'),
  says(
    'So the database builds a second structure next to the table, normally a B-tree, and it ' +
      'keeps the values of that column in sorted order with a pointer back to the row.',
  ),
  says(
    'That means a query filtering on that column can walk down the tree instead of reading ' +
      'every row, so it goes from linear to logarithmic in the number of rows.',
  ),
  asks('Anything that gets worse?'),
  says(
    'Yes, writes. Every insert and every delete now has to update the index as well, and an ' +
      'update to that column does too, so you are trading write throughput for read speed.',
  ),
]

const HALTING: TranscriptLine[] = [
  asks('You add an index to a column on a large table. What actually changes?'),
  says(
    'Em, ok. So is like, the database make another thing, separate from the table, is a tree, ' +
      'B-tree no? And inside is the value of the column in order, sorted, and also a arrow, a ' +
      'pointer, for find the row after.',
  ),
  says(
    'So when you search for this column, you no read all the rows, you go down in the tree, ' +
      'is much less steps. Logaritmic, no linear.',
  ),
  asks('Anything that gets worse?'),
  says(
    'Yes em, the write is more slow now. Because when you insert, or you delete, or you change ' +
      'this column, the database must also fix the tree. So is not free, you pay in write for ' +
      'win in read.',
  ),
]

/**
 * Everything the candidate must not be credited for.
 *
 * The interviewer states two points outright; the candidate agrees and nothing
 * more. Then the candidate reaches for a third and takes it straight back.
 */
const NOT_THEIRS: TranscriptLine[] = [
  asks('You add an index to a column on a large table. What actually changes?'),
  says('Um. It makes the queries faster, I think.'),
  asks(
    'Right — under the hood it builds a separate B-tree holding that column sorted, with a ' +
      'pointer back to each row. And writes get slower, because every insert has to maintain ' +
      'that structure too. Does that match what you had in mind?',
  ),
  says('Yeah, exactly that. That is what I meant.'),
  asks('What about disk?'),
  says('It takes more disk space — no, wait, actually I do not think it stores anything extra. Forget that.'),
]

/* ------------------------------------------------------------------- machinery */

async function machinery() {
  console.log('\nDebouncing and coalescing')
  {
    const llm = stubLLM([`{"covered":[{"index":${READS},"quote":"log n"}]}`])
    const { instance, changes } = grader(llm)
    // Three bursts of one thought. A pass each would be three times the bill for
    // the same answer.
    instance.observe([says('one')])
    instance.observe([says('one'), says('two')])
    instance.observe([says('one'), says('two'), says('three')])
    await sleep(120)

    check(llm.used() === 1, 'three turns in quick succession cost one pass', `${llm.used()} pass`)
    check(changes.length === 1 && changes[0][0] === READS, 'reports the tally once')

    // Nothing new was said, so there is nothing new to find.
    await instance.gradeNow([says('one'), says('two'), says('three')])
    check(llm.used() === 1, 'skips a pass when the candidate has said nothing new')

    // An interviewer reply is not evidence either.
    await instance.gradeNow([says('one'), says('two'), says('three'), asks('go on')])
    check(llm.used() === 1, 'and skips one after only the interviewer speaks')
    instance.stop()
  }

  console.log('\nThe pass at the end of a round')
  {
    // The reveal is the one screen the candidate reads carefully, and the last
    // answer is the one most likely to close the last gap. A pass already
    // running was started before that answer existed, so joining it is not the
    // same as grading the round.
    const llm = stubLLM(
      [`{"covered":[{"index":${STRUCTURE},"quote":"a"}]}`, `{"covered":[{"index":${WRITES},"quote":"b"}]}`],
      80,
    )
    const { instance } = grader(llm, 10)
    instance.observe([says('one')])
    // Waited for, not slept past. Sleeping longer than the debounce assumes the
    // event loop is not busy, and a stall would make this report a regression
    // that is not there.
    await llm.started()
    await instance.gradeNow([says('one'), says('two')])

    check(llm.used() === 2, 'waits a running pass out rather than joining it', `${llm.used()} passes`)
    check(
      instance.tally().join(',') === `${STRUCTURE},${WRITES}`,
      'so the last thing said is in the revealed tally',
      `[${instance.tally()}]`,
    )

    // Whatever is said after the round closes must not move the number the
    // candidate was just shown.
    instance.close()
    instance.observe([says('one'), says('two'), says('three')])
    await sleep(120)
    check(llm.used() === 2, 'and a closed round grades nothing further')
  }

  console.log('\nA tally that only grows')
  {
    const llm = stubLLM([
      `{"covered":[{"index":${STRUCTURE},"quote":"a"},{"index":${READS},"quote":"b"}]}`,
      // The same transcript, graded again, and this time point 2 is missing.
      // Sampling noise is far likelier than a genuine change of mind, and a pip
      // going dark mid-answer reads as "you just lost that".
      `{"covered":[{"index":${STRUCTURE},"quote":"a"}]}`,
    ])
    const { instance, changes } = grader(llm)
    await instance.gradeNow([says('one')])
    await instance.gradeNow([says('one'), says('two')])

    check(instance.tally().join(',') === `${STRUCTURE},${READS}`, 'keeps a point a later pass dropped')
    check(changes.length === 1, 'and does not re-notify when nothing changed', `${changes.length} change(s)`)
    instance.stop()
  }

  console.log('\nBad replies are survivable')
  {
    const llm = stubLLM([
      'not json at all',
      `{"covered":[{"index":99,"quote":"x"},{"index":0,"quote":"y"},{"index":${WRITES},"quote":"z"}]}`,
    ])
    const { instance } = grader(llm)
    await instance.gradeNow([says('one')])
    check(instance.failures === 1, 'counts the failed pass', `${instance.failures}`)
    check(instance.tally().length === 0, 'and ticks nothing from it')

    await instance.gradeNow([says('one'), says('two')])
    check(instance.tally().join(',') === String(WRITES), 'drops out-of-range indices, keeps the real one')
    check(instance.failures === 1, 'the round carries on after a failure')
    instance.stop()
  }

  console.log('\nParsing')
  {
    check(parseCoverage('{"covered":[]}', 5).length === 0, 'an empty tally is not an error')
    check(parseCoverage('{}', 5).length === 0, 'a missing key is not an error')
    // Asked for objects, a model handed a list to produce will sometimes just
    // produce the list.
    check(parseCoverage('{"covered":[1,3]}', 5).length === 2, 'accepts bare numbers too')
    check(parseCoverage('{"covered":[2,2,2]}', 5).length === 1, 'de-duplicates')
  }
}

/* ------------------------------------------------------------------ judgement */

/**
 * Did the quote really come out of the candidate's mouth?
 *
 * Normalised the way the report's citation check is: curly quotes, ellipses and
 * dashes all survive a round trip through a model in a different form, and
 * treating that as fabrication was a false alarm the last time this was checked.
 */
function quoteIsReal(quote: string, transcript: TranscriptLine[]): boolean {
  const normalise = (text: string) =>
    text
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/[.,;:!?"']/g, '')
      .replace(/\s+/g, ' ')
      .trim()

  const said = transcript
    .filter((line) => line.role === 'candidate')
    .map((line) => normalise(line.text))
    .join(' ')

  // Split on the ellipsis *before* normalising, not after: normalising strips
  // full stops, so three dots would be gone by then and the two halves of an
  // elided quote would be tested as one impossible contiguous string.
  const fragments = quote
    .split(/\.{3}|…/)
    .map((part) => normalise(part))
    .filter((part) => part !== '')
  if (fragments.length === 0) return false

  // Short fragments are ignored where there is anything longer to go on, since
  // a stray "and" matches everything. Where there is not, they are all we have —
  // and `.every` over an empty list returns true, which would certify any
  // one-word quote, including an invented one, as really said.
  const long = fragments.filter((part) => part.length > 8)
  return (long.length > 0 ? long : fragments).every((part) => said.includes(part))
}

async function judgement(llm: LLMProvider) {
  const run = async (transcript: TranscriptLine[]) => {
    const { instance } = grader(llm)
    await instance.gradeNow(transcript)
    instance.stop()
    return instance
  }

  console.log('\nA clear answer')
  const clear = await run(CLEAR)
  const clearTally = clear.tally()
  check(clearTally.includes(STRUCTURE), 'finds what an index is', `tally ${clearTally.join(',')}`)
  check(clearTally.includes(READS), 'finds the read side')
  check(clearTally.includes(WRITES), 'finds the write cost')
  check(!clearTally.includes(DISK), 'does not credit disk space, which they never mentioned')
  check(
    [...clear.evidence].every(([, quote]) => quoteIsReal(quote, CLEAR)),
    'every quote is really in the transcript',
  )

  console.log('\nThe same answer in halting English')
  const halting = await run(HALTING)
  const haltingTally = halting.tally()
  check(haltingTally.includes(STRUCTURE), 'finds what an index is', `tally ${haltingTally.join(',')}`)
  check(haltingTally.includes(READS), 'finds the read side')
  check(haltingTally.includes(WRITES), 'finds the write cost')
  /*
   * The assertion this file exists for.
   *
   * Both transcripts carry the same three points. Any essential point found in
   * the fluent one and missed in the halting one is the grader marking English,
   * and the whole tool is meant to tell a language problem from a knowledge one.
   */
  const lostToLanguage = clearTally.filter((n) => n <= 4 && !haltingTally.includes(n))
  check(
    lostToLanguage.length === 0,
    'loses nothing to the phrasing',
    lostToLanguage.length > 0 ? `missed ${lostToLanguage.join(', ')}` : '',
  )
  check(
    [...halting.evidence].every(([, quote]) => quoteIsReal(quote, HALTING)),
    'every quote is really in the transcript',
  )

  console.log('\nPoints the candidate did not make')
  const notTheirs = await run(NOT_THEIRS)
  const tally = notTheirs.tally()
  check(
    !tally.includes(STRUCTURE),
    'does not credit a point the interviewer supplied',
    `tally ${tally.join(',') || 'empty'}`,
  )
  check(!tally.includes(WRITES), 'not even when they agree with it warmly')
  check(!tally.includes(DISK), 'does not credit something they retracted')
}

async function main() {
  await machinery()

  const key = process.env.DEEPSEEK_API_KEY
  if (!key) {
    console.log(
      `\n${DIM}No DEEPSEEK_API_KEY — skipped the judgement half.` +
        ` Run with: node --env-file=.env.local --import tsx scripts/verify-grader.ts${RESET}`,
    )
  } else {
    await judgement(createDeepSeekProvider(key))
  }

  console.log(
    failures === 0
      ? `\n${GREEN}All grader checks passed.${RESET}\n`
      : `\n${RED}${failures} check(s) failed.${RESET}\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

void main()
