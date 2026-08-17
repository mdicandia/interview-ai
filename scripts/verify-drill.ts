/**
 * Proves the rapid-fire drill marks ten answers at once without confusing them.
 *
 * Split the same way `verify:grader` is, and for the same reason. The free half
 * is arithmetic and parsing — the counting, the weak-topic ranking, and what
 * happens when the model returns nonsense — and runs on every change. The live
 * half asks a real model to mark real answers, and is run deliberately.
 *
 * Three things the live half asserts, all of which are specific to grading a
 * whole run in one call rather than one answer at a time:
 *
 *   A. A terse but correct sixty-second answer scores. This format punishes
 *      length, so a grader that wants a paragraph would mark everyone down.
 *   B. **Answers do not leak between questions.** A run that answers question
 *      one well and says nothing for question two must score zero on two. This
 *      is the failure mode a batched call has and a per-answer call cannot, so
 *      it is the assertion that earns the batching.
 *   C. Silence scores nothing, and the summary says which topics were weak.
 *
 * Run with: pnpm verify:drill
 */

import { javascriptFundamentals } from '../questions/canon/javascript'
import {
  assemble,
  gradeDrill,
  parseDrillGrades,
  type DrillSubmission,
} from '../server/interview/drill-grader'
import { createDeepSeekProvider, type LLMProvider } from '../server/pipeline/llm'

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

const SET = javascriptFundamentals

/** Position of a question in the set, by id, so the assertions read in English. */
function at(id: string): number {
  const index = SET.questions.findIndex((question) => question.id === id)
  if (index === -1) throw new Error(`${SET.slug} has no question "${id}" — the bank moved`)
  return index
}

const EVENT_LOOP = at('event-loop')
const MICROTASK_ORDER = at('microtask-order')
const CLOSURES = at('closures')
const FUNCTIONAL = at('functional-programming')

function say(index: number, text: string): DrillSubmission {
  return { index, text, spokenSeconds: Math.min(60, text.split(/\s+/).length / 2.5) }
}

/* ------------------------------------------------------------------ machinery */

function machinery() {
  console.log('\nParsing')
  {
    check(parseDrillGrades('{"results":[]}', 10).size === 0, 'an empty result set is not an error')
    check(parseDrillGrades('{}', 10).size === 0, 'a missing key is not an error')

    const graded = parseDrillGrades(
      '{"results":[{"question":1,"covered":[1,3,3]},{"question":99,"covered":[1]},' +
        '{"question":2,"covered":"nonsense"}]}',
      10,
    )
    check(graded.get(1)?.join(',') === '1,3', 'de-duplicates the indices in one answer')
    check(!graded.has(99), 'drops a question number the set does not have')
    check(graded.get(2)?.length === 0, 'a malformed covered list grades as zero, not as a throw')

    let threw = false
    try {
      parseDrillGrades('not json at all', 10)
    } catch {
      threw = true
    }
    check(threw, 'unparseable JSON throws, so the route can answer 502 rather than lie')
  }

  console.log('\nCounting')
  {
    // Question 1 fully covered, question 2 half, question 3 not answered at all.
    const answers = new Map([
      [EVENT_LOOP, say(EVENT_LOOP, 'single thread, queues, microtasks drain first')],
      [MICROTASK_ORDER, say(MICROTASK_ORDER, 'one three four two')],
      [CLOSURES, say(CLOSURES, '')],
    ])
    const graded = new Map([
      [EVENT_LOOP + 1, [1, 2, 3]],
      [MICROTASK_ORDER + 1, [1]],
      // The model claims points for a question that was never answered.
      [CLOSURES + 1, [1, 2]],
      // And for one out of range for its question.
      [FUNCTIONAL + 1, [1, 9]],
    ])
    const result = assemble(SET, answers, graded)

    check(
      result.questions[CLOSURES].covered.length === 0,
      'an unanswered question scores zero however the model marked it',
    )
    check(
      result.questions[FUNCTIONAL].covered.length === 0,
      'and so does one with no submission at all',
    )
    check(
      result.questions[EVENT_LOOP].covered.length === 3,
      'a fully covered question keeps all its points',
    )
    check(
      result.total === SET.questions.reduce((sum, q) => sum + q.expectedPoints.length, 0),
      'the denominator is the whole set, not just what was answered',
      `${result.total}`,
    )
    check(result.covered === 4, 'the numerator counts only what survived', `${result.covered}`)
  }

  console.log('\nWeak topics')
  {
    // Everything answered perfectly except one topic, which gets nothing.
    const answers = new Map(SET.questions.map((_q, i) => [i, say(i, 'an answer')]))
    const graded = new Map(
      SET.questions.map((question, i) => [
        i + 1,
        question.topic === 'closures' ? [] : question.expectedPoints.map((_p, j) => j + 1),
      ]),
    )
    const result = assemble(SET, answers, graded)

    check(
      result.weakTopics.length === 1 && result.weakTopics[0].topic === 'closures',
      'names the one topic that came out under half',
      result.weakTopics.map((t) => t.topic).join(', ') || 'none',
    )
    check(
      result.weakTopics[0]?.covered === 0,
      'with its own tally rather than the whole run’s',
    )

    const perfect = assemble(
      SET,
      answers,
      new Map(
        SET.questions.map((question, i) => [i + 1, question.expectedPoints.map((_p, j) => j + 1)]),
      ),
    )
    check(perfect.weakTopics.length === 0, 'and says nothing when nothing was weak')
  }
}

/* ------------------------------------------------------------------ judgement */

/**
 * A real run: two answered well, one answered badly, one left silent.
 *
 * The terse answers are deliberate. Sixty seconds spoken aloud is roughly what
 * is written here — anything longer would be testing an essay rather than the
 * format, and a grader that only rewards the essay is the regression this
 * catches.
 */
const RUN: DrillSubmission[] = [
  say(
    EVENT_LOOP,
    'So JavaScript is one thread, one call stack. The waiting happens outside, in the runtime, ' +
      'and when it finishes the callback goes on a queue. The event loop takes from the queue ' +
      'when the stack is empty. And there are two queues really, the microtasks from promises ' +
      'drain completely before the next setTimeout.',
  ),
  // Silence. Must score zero, and must not be rescued by the answer above it
  // even though the two questions are about the same subject.
  say(MICROTASK_ORDER, ''),
  say(
    CLOSURES,
    'A closure is when the function still can see the variables from where it was created, even ' +
      'after that function outside already finished. Like a debounce, or the handlers in React.',
  ),
  // Names the topic and nothing else. "Only names the topic is not covered."
  say(FUNCTIONAL, 'Functional programming is, em, programming with functions. It is a paradigm.'),
]

async function judgement(llm: LLMProvider) {
  console.log('\nMarking a whole run in one pass')
  const result = await gradeDrill(llm, SET, RUN)

  const eventLoop = result.questions[EVENT_LOOP]
  check(
    eventLoop.covered.length >= 2,
    'a terse but correct answer scores',
    `${eventLoop.covered.length}/${eventLoop.points.length}`,
  )

  const closures = result.questions[CLOSURES]
  check(
    closures.covered.length >= 1,
    'so does a two-sentence one',
    `${closures.covered.length}/${closures.points.length}`,
  )

  /*
   * The assertion that earns the batching.
   *
   * Question 2 asks about microtask ordering and was answered with silence.
   * Question 1, right above it, explains microtask ordering in detail. A grader
   * reading all ten at once is exactly the thing that could credit one to the
   * other, and it must not.
   */
  const silent = result.questions[MICROTASK_ORDER]
  check(
    silent.covered.length === 0,
    'a silent answer scores nothing, even when the answer beside it covers the same ground',
    `${silent.covered.length} point(s)`,
  )
  check(silent.answer === '', 'and is reported as silence rather than as a wrong answer')

  const vague = result.questions[FUNCTIONAL]
  check(
    vague.covered.length === 0,
    'naming the topic is not answering the question',
    `${vague.covered.length}/${vague.points.length}`,
  )

  check(
    result.questions.length === SET.questions.length,
    'every question in the set is reported, not only the ones submitted',
    `${result.questions.length}`,
  )

  const weak = result.weakTopics.map((t) => t.topic)
  check(
    weak.includes('functional programming'),
    'the summary names the topic that was actually weak',
    weak.join(', ') || 'none',
  )
}

async function main() {
  machinery()

  const key = process.env.SKIP_LIVE ? undefined : process.env.DEEPSEEK_API_KEY
  if (!key) {
    console.log(
      `\n${DIM}Skipped the judgement half — ${
        process.env.SKIP_LIVE ? 'SKIP_LIVE is set' : 'no DEEPSEEK_API_KEY'
      }. Run it with: pnpm verify:drill${RESET}`,
    )
  } else {
    await judgement(createDeepSeekProvider(key))
  }

  console.log(
    failures === 0
      ? `\n${GREEN}All drill checks passed.${RESET}\n`
      : `\n${RED}${failures} check(s) failed.${RESET}\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

void main()
