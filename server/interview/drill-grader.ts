import type { RapidFireSet } from '@/lib/problems/types'
import type { LLMProvider, Message } from '../pipeline/llm'

/**
 * Grades a whole rapid-fire run in one pass.
 *
 * **One call over ten answers, not ten calls over one answer each.** Three
 * reasons, in order of how much they matter:
 *
 * 1. The expected points for the whole set are one frozen block, so ten answers
 *    share a single cached prefix instead of paying for ten near-identical ones.
 * 2. It reads like a marker with the paper in front of them. Someone who
 *    explained microtasks properly in question two and then said "as I mentioned"
 *    in question three has answered question three, and a per-question call
 *    cannot see that.
 * 3. Nothing is waiting. The drill is over; this runs once, on a page that has
 *    already told the candidate it is marking.
 *
 * It shares its judging rules with `CoverageGrader` almost verbatim — mark the
 * substance and never the wording, only the candidate's own words count, do not
 * infer. Deliberately not shared as one string: the two differ in the part that
 * matters here, which is that a sixty-second answer has no interviewer in it to
 * accidentally give the answer away, and gains a rule about not crediting a
 * point to the wrong question.
 */

export interface DrillSubmission {
  /** Position in the set. The browser never holds the question ids. */
  index: number
  text: string
  spokenSeconds: number
}

export interface DrillQuestionResult {
  id: string
  prompt: string
  topic: string
  /** 1-based indices into that question's own expected points. */
  covered: number[]
  points: string[]
  /** What the candidate actually said, echoed back so the screen can show it. */
  answer: string
  spokenSeconds: number
}

export interface DrillResult {
  setSlug: string
  title: string
  covered: number
  total: number
  questions: DrillQuestionResult[]
  /**
   * Topics where less than half the expected points were reached, worst first.
   *
   * The reason this exists rather than a score: a score says how the morning
   * went, and a list of topics says what to read this afternoon. Computed here
   * rather than asked of the model — it is arithmetic, and a model asked to
   * summarise its own marking will soften it.
   */
  weakTopics: { topic: string; covered: number; total: number }[]
}

const RULES = `You are marking a rapid-fire technical screen. The candidate had sixty seconds per question, speaking out loud, with no chance to revise. You do not talk to them and they never see your output.

Your only job: for each question, decide which of its numbered points the answer actually reached.

How to judge:
- Mark the substance, never the wording. An answer given in clumsy, hesitant or non-native English is still the answer. Spoken transcripts have no punctuation to speak of and get technical terms slightly wrong; judge what was meant.
- Sixty seconds is short. Do not withhold a point because the answer was terse — terse and correct is exactly right for this format.
- Do not infer. "They clearly know this" is not evidence. If they did not say it, it is not covered.
- If they say something and then retract or contradict it, it is not covered.
- Judge each answer only against its own question's points. Something said under question 4 does not earn a point under question 7 — with one exception: if an answer explicitly refers back ("like I said with the event loop") and the earlier answer did contain the substance, count it.
- An empty answer covers nothing. Say so rather than guessing what they would have said.

Reply with a single JSON object and nothing else:

{"results": [{"question": 1, "covered": [1, 3]}, {"question": 2, "covered": []}]}

Include an entry for every question, in order, even when nothing was covered.`

/**
 * The cached half: the questions and their answer keys.
 *
 * Deterministic for a given set, so a second run of the same drill hits
 * DeepSeek's prefix cache outright.
 */
export function buildDrillPrefix(set: RapidFireSet): string {
  const questions = set.questions.map((question, i) => {
    const points = question.expectedPoints.map((point, j) => `   ${j + 1}. ${point}`)
    return [`QUESTION ${i + 1}: ${question.prompt}`, '   Points:', ...points].join('\n')
  })
  return [RULES, '', `--- THE QUESTIONS AND THEIR POINTS (${set.title}) ---`, '', ...questions].join(
    '\n',
  )
}

function renderAnswers(set: RapidFireSet, answers: Map<number, DrillSubmission>): string {
  const lines = set.questions.map((_question, i) => {
    const said = answers.get(i)?.text.trim()
    return `ANSWER ${i + 1}: ${said ? said : '(said nothing)'}`
  })
  return ['--- WHAT THEY SAID ---', '', ...lines].join('\n\n')
}

export async function gradeDrill(
  llm: LLMProvider,
  set: RapidFireSet,
  submissions: DrillSubmission[],
): Promise<DrillResult> {
  const byIndex = new Map(submissions.map((answer) => [answer.index, answer]))

  const messages: Message[] = [
    { role: 'system', content: buildDrillPrefix(set) },
    { role: 'user', content: renderAnswers(set, byIndex) },
  ]

  const raw = await llm.complete({
    messages,
    // Same call the live coverage grader makes: this is matching against a list
    // that is already written down, not a judgement call, and the fast model is
    // measurably good enough at it.
    fast: true,
    json: true,
    // Room for an entry per question with several indices each, plus slack for
    // the model restating the schema. Truncation fails the parse and loses the
    // whole run, which is the one failure worth over-provisioning against.
    maxTokens: 1_200,
  })

  const graded = parseDrillGrades(raw, set.questions.length)
  return assemble(set, byIndex, graded)
}

/**
 * Reads a grading pass out of the model's raw JSON.
 *
 * Defensive throughout, and lenient about *shape* while strict about *range*: a
 * hallucinated point number means nothing was observed, and clamping it would
 * credit an answer with a point the model never looked at. A question missing
 * from the reply is not an error — it grades as zero, which is what an
 * unmentioned question means.
 */
export function parseDrillGrades(raw: string, questionCount: number): Map<number, number[]> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw || '{}')
  } catch {
    throw new Error(`drill grader returned unparseable JSON: ${raw.slice(0, 120)}`)
  }

  const out = new Map<number, number[]>()
  if (typeof parsed !== 'object' || parsed === null) return out

  const list = (parsed as { results?: unknown }).results
  if (!Array.isArray(list)) return out

  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue
    const question = Number((entry as { question?: unknown }).question)
    if (!Number.isInteger(question) || question < 1 || question > questionCount) continue

    const covered = (entry as { covered?: unknown }).covered
    const indices = Array.isArray(covered)
      ? [...new Set(covered.map(Number).filter((n) => Number.isInteger(n) && n >= 1))].sort(
          (a, b) => a - b,
        )
      : []
    // Last entry wins on a duplicated question number, which is arbitrary but
    // has to be something; the alternative of unioning them would let one
    // malformed repeat inflate the score.
    out.set(question, indices)
  }

  return out
}

/**
 * Joins the model's answer to the set, and does the arithmetic itself.
 *
 * Split out from `gradeDrill` so the verification script can exercise the
 * counting and the weak-topic ranking without a network call — that half is
 * where an off-by-one lives, and it should not cost money to check.
 */
export function assemble(
  set: RapidFireSet,
  answers: Map<number, DrillSubmission>,
  graded: Map<number, number[]>,
): DrillResult {
  const questions: DrillQuestionResult[] = set.questions.map((question, i) => {
    const answer = answers.get(i)
    const said = answer?.text.trim() ?? ''
    // An answer that was never given cannot have covered anything, whatever the
    // model returned for it. Cheap, and it is the assertion that keeps a
    // silent run from scoring.
    const covered = said === '' ? [] : (graded.get(i + 1) ?? [])
    return {
      id: question.id,
      prompt: question.prompt,
      topic: question.topic,
      covered: covered.filter((index) => index <= question.expectedPoints.length),
      points: question.expectedPoints,
      answer: said,
      spokenSeconds: answer?.spokenSeconds ?? 0,
    }
  })

  const byTopic = new Map<string, { covered: number; total: number }>()
  for (const question of questions) {
    const tally = byTopic.get(question.topic) ?? { covered: 0, total: 0 }
    tally.covered += question.covered.length
    tally.total += question.points.length
    byTopic.set(question.topic, tally)
  }

  const weakTopics = [...byTopic.entries()]
    .map(([topic, tally]) => ({ topic, ...tally }))
    .filter((entry) => entry.covered * 2 < entry.total)
    .sort((a, b) => a.covered / a.total - b.covered / b.total)

  return {
    setSlug: set.slug,
    title: set.title,
    covered: questions.reduce((sum, q) => sum + q.covered.length, 0),
    total: questions.reduce((sum, q) => sum + q.points.length, 0),
    questions,
    weakTopics,
  }
}
