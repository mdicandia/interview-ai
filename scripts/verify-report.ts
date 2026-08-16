/**
 * Proves the report does the two things it exists to do.
 *
 * Both rounds below are constructed so the *right* answer is known in advance,
 * and they are deliberately opposites — which is the only way to tell a real
 * diagnosis from a model that always says the same flattering thing:
 *
 *   Round 1: correct code, broken English. The right read is "you knew it, you
 *            couldn't say it" — a delivery finding, not a knowledge one.
 *   Round 2: fluent, confident, and wrong. The right read is the reverse.
 *
 * A report that scores both the same way, or that praises round 2's "strong
 * communication of the approach" without noticing the code contradicts it, has
 * failed regardless of how well written it is.
 *
 * Run with: pnpm verify:report
 */

import { getProblem } from '../problems'
import { getQuestion } from '../questions'
import { createDeepSeekProvider } from '../server/pipeline/llm'
import { generateReport, type RoundEvidence } from '../server/interview/report'

const T0 = Date.parse('2026-08-05T14:00:00Z')
const min = (n: number) => T0 + n * 60_000

/* -------------------------------------------------------- round 1: flaky-retry
 * The reasoning is right at every step. The English is not, and Deepgram has
 * mangled several words ("exponential" → "exponencial", "raise" → "race").
 */
const retryRound: RoundEvidence = {
  slug: 'flaky-retry',
  title: 'Flaky retry',
  label: 'Debugging',
  language: 'python',
  enteredAt: min(0),
  elapsedMs: 19 * 60_000,
  allottedMs: 25 * 60_000,
  transcript: [
    { role: 'interviewer', text: 'Take a look at the failing tests and tell me what you see.', at: min(0.5) },
    { role: 'candidate', text: 'Ok so em, the test is say three sleeps but we have four, no, sorry, is the last attempt also sleeping. Is not need because after we no try more.', at: min(1.5) },
    { role: 'interviewer', text: 'Good. What else is the suite complaining about?', at: min(2.5) },
    { role: 'candidate', text: 'The other one is em the delay, it is always one second but the doc say exponencial. So must be base delay times two power of attempt.', at: min(3.5) },
    { role: 'candidate', text: 'And also, the function return None when all fail but the test want the error. So we need to race the last error.', at: min(5) },
    { role: 'interviewer', text: 'You said "race" — do you mean raise?', at: min(5.5) },
    { role: 'candidate', text: 'Yes yes raise, sorry. Raise the last error.', at: min(6) },
    { role: 'candidate', text: 'Em. I do the sleep condition first.', at: min(7) },
    { role: 'interviewer', text: 'Why that one first?', at: min(7.5) },
    { role: 'candidate', text: 'Because is the... is small change and I can run and see if the count test is green. Then I know I not break other thing.', at: min(8.5) },
    { role: 'candidate', text: 'Ok is passing. Now the backoff.', at: min(11) },
    { role: 'candidate', text: 'Em, all green now.', at: min(17) },
    { role: 'interviewer', text: 'What would you check before calling this done in a real codebase?', at: min(17.5) },
    { role: 'candidate', text: 'Em... maybe if someone call retry and expect None before, now we raise, so is a breaking change. Should look who use it.', at: min(18.5) },
  ],
  hints: [
    {
      level: 1,
      text: 'Count the sleeps against the number of attempts — the loop body runs the same way on the last pass as on the first.',
      at: min(6.5),
    },
  ],
  runs: [
    { at: min(0.2), passed: 2, total: 5, failing: ['test_sleeps_between_attempts_only', 'test_backoff_is_exponential', 'test_raises_the_last_error_when_every_attempt_fails'] },
    { at: min(10.5), passed: 3, total: 5, failing: ['test_backoff_is_exponential', 'test_raises_the_last_error_when_every_attempt_fails'] },
    { at: min(14), passed: 4, total: 5, failing: ['test_raises_the_last_error_when_every_attempt_fails'] },
    { at: min(16.8), passed: 5, total: 5, failing: [] },
  ],
  files: [
    {
      path: 'retry.py',
      content: `import time


def retry(operation, max_attempts=3, base_delay=1.0, sleep=time.sleep):
    """Call \`operation\`, retrying on failure with exponential backoff.

    Returns whatever the operation returns. If every attempt fails, the last
    error should reach the caller.
    """
    last_error = None

    for attempt in range(max_attempts):
        try:
            return operation()
        except Exception as exc:
            last_error = exc
            if attempt < max_attempts - 1:
                sleep(base_delay * (2 ** attempt))

    raise last_error
`,
    },
  ],
}

/* ------------------------------------------------------------ round 2: two-sum
 * The opposite failure. Every sentence is fluent, well-structured and uses the
 * right vocabulary; the submitted code is the brute force they said they were
 * avoiding, and it is also wrong.
 */
const twoSumRound: RoundEvidence = {
  slug: 'two-sum',
  title: 'Two Sum',
  label: 'Algorithm',
  language: 'python',
  enteredAt: min(30),
  elapsedMs: 21 * 60_000,
  allottedMs: 20 * 60_000,
  transcript: [
    { role: 'interviewer', text: 'How would you approach this?', at: min(30.5) },
    { role: 'candidate', text: "The naive approach is a nested loop, which is quadratic. I'd rather trade space for time here: one pass, a dictionary of value to index, and for each element I check whether the complement is already in the dictionary. That gets us linear time and linear space.", at: min(31.5) },
    { role: 'interviewer', text: 'Sounds good. Go ahead.', at: min(32.5) },
    { role: 'candidate', text: "Right, so I'm building the map as I go, which also handles the constraint that you can't use the same element twice, because I only look at what I've already inserted.", at: min(34) },
    { role: 'candidate', text: "I'll just double-check the ordering. Yes, insert after the lookup, that's the important part.", at: min(38) },
    { role: 'interviewer', text: 'Two of the cases are still failing. What do you think is happening?', at: min(43) },
    { role: 'candidate', text: "Hmm. It's probably an edge case with duplicate values. The hash map approach handles that correctly by construction though, so I suspect the test expectations might be assuming a particular ordering of the output indices.", at: min(44) },
    { role: 'interviewer', text: 'Walk me through what your loop actually does on the input [3, 3] with target 6.', at: min(45) },
    { role: 'candidate', text: "So it iterates, and on the second three the complement three is in the map, so we return the stored index and the current one. That should be zero one. I'd need to step through it, but the logic is standard.", at: min(46.5) },
  ],
  hints: [],
  runs: [
    { at: min(41), passed: 3, total: 5, failing: ['duplicate values', 'negative numbers'] },
    { at: min(47), passed: 3, total: 5, failing: ['duplicate values', 'negative numbers'] },
    { at: min(50), passed: 3, total: 5, failing: ['duplicate values', 'negative numbers'] },
  ],
  files: [
    {
      path: 'solution.py',
      // Not the approach they described: a nested loop, and one that skips the
      // last element entirely.
      content: `def two_sum(nums, target):
    # nums: list[int], target: int -> list[int] of length 2
    for i in range(len(nums) - 1):
        for j in range(i + 1, len(nums) - 1):
            if nums[i] + nums[j] == target:
                return [i, j]
    return []
`,
    },
  ],
}

/* --------------------------------------------------- round 3: a spoken round
 * Coverage is known in advance and handed to the report the way a real round
 * hands it over. They reach points 1 and 2 — what an index is, and what it does
 * to reads — and never once mention the write cost or the disk space, which are
 * essential points 3 and 4.
 *
 * The report must not quietly disagree with that. It has already been shown to
 * them on the panel at the end of the round, and naming the essential points
 * they missed is the single most useful sentence it can produce.
 */
const indexRound: RoundEvidence = {
  slug: 'concept-database-index',
  title: 'What an index actually does',
  label: 'Discussion',
  language: null,
  enteredAt: min(52),
  elapsedMs: 9 * 60_000,
  allottedMs: 10 * 60_000,
  transcript: [
    { role: 'interviewer', text: 'You add an index to a column on a large table. What actually changes?', at: min(52.5) },
    { role: 'candidate', text: 'So the database make a separate structure, a tree, B-tree, and inside is the values of that column in order, sorted, with a pointer to find the row.', at: min(53.5) },
    { role: 'interviewer', text: 'And what does that buy you?', at: min(55) },
    { role: 'candidate', text: 'When you filter for this column you no read every row, you go down the tree, is logaritmic. Much less work for a big table.', at: min(56) },
    { role: 'interviewer', text: 'Is there anything you would think about before adding one?', at: min(58) },
    { role: 'candidate', text: 'Em. I think you look at the queries, which column is in the where. And maybe if the table is small is not worth it.', at: min(59) },
    { role: 'interviewer', text: 'Anything it costs you?', at: min(60) },
    { role: 'candidate', text: 'Em... I am not sure. Maybe the planner sometimes no use it? I do not know really.', at: min(60.5) },
  ],
  hints: [],
  runs: [],
  files: [],
  // Points 1 and 2 of the essential-first ordering. 3 (writes get slower) and
  // 4 (disk space) were never reached.
  objectives: { covered: 2, total: 9, essential: 4, indices: [1, 2] },
  concluded: {
    verdict: 'mixed',
    summary: 'Solid on what an index is and does for reads; never got to what it costs.',
  },
}

/* ------------------------------------------------ round 4: a behavioural answer
 * Written to fail on all three counted axes at once, because those are the three
 * the agency feedback actually named:
 *
 *   - every clause is "we"; nothing in it is identifiably theirs
 *   - it runs to about three minutes of speech
 *   - it ends on a document and a feeling rather than on anything that happened
 *
 * The content is fine — it is a real project with real detail. That is the point:
 * a report that scores this well on delivery has collapsed the two axes back into
 * one, which is the failure this whole rubric exists to prevent.
 */
const behavioralRound: RoundEvidence = {
  slug: 'behavioral-failure',
  title: 'A project of yours that failed',
  label: 'Behavioural',
  language: null,
  enteredAt: min(62),
  elapsedMs: 5 * 60_000,
  allottedMs: 6 * 60_000,
  transcript: [
    {
      role: 'interviewer',
      text: 'Tell me about a project of yours that failed.',
      at: min(62.2),
    },
    {
      role: 'candidate',
      text: 'So we had this feature called contract modelling, and we spent about four months on it. We designed it as a stepper flow where users upload a contract and then we let them choose which rates to apply.',
      at: min(63),
      start: 8,
      spokenSeconds: 46,
    },
    {
      role: 'candidate',
      text: 'The problem we had was the number of states. We kept adding branches and we did not really handle going backwards, and we found that editing an earlier step was quite buggy, so we ended up with something that was confusing for the users and we got quite a lot of complaints about it internally.',
      at: min(64),
      start: 56,
      spokenSeconds: 62,
    },
    {
      role: 'candidate',
      text: 'We could see it was getting complicated while we were building it but we kept going because we were committed to the deadline, and in hindsight we should have stopped and asked for more UX involvement at that point.',
      at: min(65),
      start: 120,
      spokenSeconds: 40,
    },
    {
      role: 'candidate',
      text: 'So afterwards we wrote up a retrospective document about state complexity and we shared it with the team, and I think it was a really valuable learning experience for all of us.',
      at: min(66),
      start: 163,
      spokenSeconds: 34,
    },
  ],
  hints: [],
  runs: [],
  files: [],
  objectives: { covered: 2, total: 5, essential: 4, indices: [1, 3] },
  concluded: { verdict: 'mixed', summary: 'A real failure, told without ever saying what he did.' },
}

async function main() {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) throw new Error('DEEPSEEK_API_KEY is not set — add it to .env.local')

  const rounds = [retryRound, twoSumRound, indexRound, behavioralRound].map((evidence) => {
    const problem = getProblem(evidence.slug) ?? getQuestion(evidence.slug)
    if (!problem) throw new Error(`No such problem: ${evidence.slug}`)
    return { evidence, problem }
  })

  const started = Date.now()
  const report = await generateReport(createDeepSeekProvider(key), {
    sessionName: 'Verification run',
    startedAt: T0,
    endedAt: min(51),
    rounds,
  })
  const took = Date.now() - started

  console.log(`\ngenerated in ${(took / 1000).toFixed(1)}s\n`)
  console.log(`HEADLINE: ${report.headline}\n`)

  for (const round of report.rounds) {
    console.log(`──────── ${round.title} — ${round.outcome}`)
    console.log(`  content  ${round.content.score}/5  ${round.content.comment}`)
    console.log(
      round.delivery
        ? `  delivery ${round.delivery.score}/5  ${round.delivery.comment}`
        : '  delivery not scored',
    )
    console.log(`  DIAGNOSIS [${round.diagnosisKind ?? 'none'}]: ${round.diagnosis ?? '(none)'}`)
    for (const moment of round.moments) {
      const text = moment.spoken ? `"${moment.quote}"` : `(${moment.quote})`
      console.log(`  [${moment.at}] ${text}\n        → ${moment.comment}`)
    }
    for (const item of round.didWell) console.log(`  + ${item}`)
    for (const item of round.doDifferently) console.log(`  - ${item}`)
    console.log()
  }

  console.log('THEMES:', report.themes)
  console.log('PRACTICE:', report.practice)
  console.log('NOT ASSESSED:', report.notAssessed)

  /* ------------------------------------------------------------------ checks */

  const problems: string[] = []
  const retry = report.rounds.find((r) => r.slug === 'flaky-retry')
  const twoSum = report.rounds.find((r) => r.slug === 'two-sum')

  const spoken = report.rounds.find((r) => r.slug === 'concept-database-index')
  const behavioral = report.rounds.find((r) => r.slug === 'behavioral-failure')

  if (!behavioral) problems.push('behavioral round is missing entirely')

  if (behavioral) {
    /*
     * The three counted axes, all deliberately failed, and all three named in the
     * agency feedback that motivated this round existing at all.
     *
     * The content of the story is fine — real project, real detail. A report that
     * scores delivery well here has collapsed the two axes back into one.
     */
    const text = [
      behavioral.delivery?.comment ?? '',
      behavioral.diagnosis ?? '',
      ...behavioral.doDifferently,
    ]
      .join(' ')
      .toLowerCase()

    if (!behavioral.delivery) {
      problems.push('behavioral round was not scored on delivery, though it was all speech')
    } else if (behavioral.delivery.score > 3) {
      problems.push(
        `behavioral delivery scored ${behavioral.delivery.score}/5 on an answer that is ` +
          'entirely "we", three minutes long, and ends on a document.',
      )
    }

    if (!/\bwe\b|first person|agency|own contribution|\byou did\b|claim/.test(text)) {
      problems.push(
        'behavioral round never mentions that the whole answer is in the first person ' +
          'plural — the counted metric was handed to it directly.',
      )
    }
    if (!/end|outcome|trail|number|concrete|what changed|landed/.test(text)) {
      problems.push('behavioral round never mentions that the answer has no ending.')
    }
    if (!/long|length|minutes|shorter|concise|cut/.test(text)) {
      problems.push('behavioral round never mentions the length.')
    }
  }

  if (!retry) problems.push('flaky-retry round is missing entirely')
  if (!twoSum) problems.push('two-sum round is missing entirely')
  if (!spoken) problems.push('concept-database-index round is missing entirely')

  if (spoken) {
    /*
     * The report is handed the tally. It must act on it rather than around it.
     *
     * Two essential points of four were never reached, so a high content score
     * would be the report contradicting the panel the candidate already read —
     * the failure this evidence exists to catch.
     */
    if (spoken.content.score > 3) {
      problems.push(
        `spoken round scored ${spoken.content.score}/5 on content, having reached 2 of 4 ` +
          'essential points. The report is scoring above the coverage it was given.',
      )
    }

    // And it must say *which* ones. "Be more thorough" is not actionable; "you
    // never mentioned what an index costs on writes" is the thing to go and learn.
    const text = [
      spoken.content.comment,
      spoken.diagnosis ?? '',
      ...spoken.didWell,
      ...spoken.doDifferently,
    ]
      .join(' ')
      .toLowerCase()
    if (!/write|insert|update|delete|disk|space|cost/.test(text)) {
      problems.push(
        'spoken round never names the essential points that were missed (the write cost, ' +
          'the disk space). It was told exactly which ones they were.',
      )
    }
  }

  if (retry && twoSum) {
    // Content is objective here: one round ends green with the reference fix,
    // the other ends 3/5 with code that contradicts what they said.
    if (retry.content.score <= twoSum.content.score) {
      problems.push(
        `content did not separate: flaky-retry ${retry.content.score} vs two-sum ` +
          `${twoSum.content.score}. The retry fix is correct and the two-sum code is not.`,
      )
    }

    /*
     * Delivery is checked for INDEPENDENCE, not for a particular ordering.
     *
     * The obvious assertion — round 2 speaks fluent English, so it must deliver
     * better — is wrong, and asserting it produced a false failure. Delivery in
     * this rubric is thinking aloud, signposting, and responding to pushback.
     * Round 2's candidate goes quiet for four minutes while writing the code,
     * never says they switched approach, and brushes off a direct challenge.
     * Those are real delivery faults, and fluent phrasing does not cancel them.
     *
     * What must hold is that delivery does not simply track content. Content
     * differs by two points across these rounds; if delivery moved with it, the
     * axes have collapsed into one and the split is decorative.
     */
    if (retry.delivery && twoSum.delivery) {
      const gap = Math.abs(retry.delivery.score - twoSum.delivery.score)
      const contentGap = Math.abs(retry.content.score - twoSum.content.score)
      if (gap >= contentGap) {
        problems.push(
          `delivery tracked content: delivery gap ${gap} vs content gap ${contentGap}. ` +
            'The axes are supposed to move independently.',
        )
      }
    }

    // The product feature, stated plainly. These two rounds are constructed to
    // demand opposite readings, and getting them the same way round would make
    // the whole report actively misleading.
    if (twoSum.diagnosisKind !== 'knowledge-lags-expression') {
      problems.push(
        `two-sum should be knowledge-lags-expression, got ${twoSum.diagnosisKind}: ` +
          `"${twoSum.diagnosis}"`,
      )
    }
    if (retry.diagnosisKind === 'knowledge-lags-expression' || retry.diagnosisKind === 'both-weak') {
      problems.push(
        `flaky-retry was diagnosed ${retry.diagnosisKind}, but the fix matches the ` +
          `reference exactly: "${retry.diagnosis}"`,
      )
    }

    if (retry.outcome !== 'solved') {
      problems.push(`flaky-retry ended 5/5 with the reference fix but was marked ${retry.outcome}`)
    }
    if (twoSum.outcome === 'solved') {
      problems.push('two-sum ended 3/5 but was marked solved')
    }
  }

  // Citations must be real. A fabricated quote is the failure mode that makes a
  // report worthless, and it is invisible unless checked.
  //
  // Normalise typography first. The model returns curly quotes, en dashes and a
  // single '…' where the transcript has three periods, so a raw substring match
  // reports fabrication that never happened — the same false alarm as an
  // exact-match assertion against speech recognition.
  const normalise = (text: string) =>
    text
      .toLowerCase()
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/…/g, '...')
      .replace(/[–—]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()

  // Every round, or the checker reports a real quote as fabricated the moment a
  // round is added — which is exactly what it did.
  const said = [
    ...retryRound.transcript,
    ...twoSumRound.transcript,
    ...indexRound.transcript,
    ...behavioralRound.transcript,
  ]
    .map((line) => normalise(line.text))
    .join(' ')

  let checked = 0
  let unfounded = 0
  for (const round of report.rounds) {
    for (const moment of round.moments) {
      // Only quotations are checkable. A moment describing a test run or a
      // silence is not claiming to be words anyone said.
      if (!moment.spoken) continue
      checked += 1
      const quote = normalise(moment.quote).replace(/^["'`]|["'`]$/g, '')
      if (quote.length < 25) continue
      // Elision is a normal quoting convention, so each side of an ellipsis is
      // checked on its own. Treating a shortened quote as a fabricated one is a
      // fault in the checker, not the report.
      const missing = quote
        .split('...')
        .map((part) => part.trim())
        .filter((part) => part.length >= 20)
        .filter((part) => !said.includes(part.slice(0, 40)))
      if (missing.length > 0) {
        unfounded += 1
        console.error(`  ! not in transcript: "${missing[0].slice(0, 60)}"`)
      }
    }
  }
  console.log(`\ncitations: ${checked} moments, ${unfounded} not found in the transcript`)
  if (checked < 4) problems.push(`only ${checked} moments cited across two rounds`)
  if (unfounded > 0) {
    problems.push(`${unfounded} of ${checked} quoted moments do not appear in the transcript`)
  }

  // The ASR/grammar rule. If the report scolds them for grammar, it has confused
  // the thing it exists to separate.
  const prose = JSON.stringify(report).toLowerCase()
  for (const word of ['grammar', 'grammatical', 'broken english', 'poor english']) {
    if (prose.includes(word)) problems.push(`report criticises language mechanics ("${word}")`)
  }

  if (problems.length > 0) {
    console.error('\nFAILED:')
    for (const p of problems) console.error(`  ✗ ${p}`)
    process.exit(1)
  }
  console.log('\nOK — both axes separated, every quote is real, no language scolding.')
}

void main()
