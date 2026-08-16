import type { DiscussionProblem } from '@/lib/problems/types'
import { llmEvalDesign, tradeoffRagVsFinetune } from './ai'
import { BEHAVIORAL_QUESTIONS } from './behavioral'
import { codeReviewPython } from './code-review-python'
import { codeReviewTypescript } from './code-review-typescript'
import { conceptDatabaseIndex, conceptRequestLifecycle, tradeoffQueueVsDirect } from './concepts'
import { diagnosisP99Regression, systemDesignUrlShortener } from './scenarios'

/**
 * The non-coding question bank.
 *
 * Deliberately kept out of `PROBLEMS`, because a verbal answer has no test suite
 * and so cannot share a type with something that does. It is otherwise a
 * first-class round: it appears in the picker under "Questions (no coding)", the
 * interviewer asks it out loud, and a separate grader scores what was said
 * against `expectedPoints`.
 *
 * That last part is why the rubric was written before any of the machinery
 * existed — the bank needed no rewrite when the interviewer arrived.
 */
export const QUESTIONS: readonly DiscussionProblem[] = [
  codeReviewPython,
  codeReviewTypescript,
  conceptDatabaseIndex,
  conceptRequestLifecycle,
  tradeoffQueueVsDirect,
  diagnosisP99Regression,
  systemDesignUrlShortener,
  llmEvalDesign,
  tradeoffRagVsFinetune,
  ...BEHAVIORAL_QUESTIONS,
]

const BY_SLUG = new Map(QUESTIONS.map((q) => [q.slug, q]))

export function getQuestion(slug: string): DiscussionProblem | undefined {
  return BY_SLUG.get(slug)
}

/**
 * The shape safe to send to a browser: the expected answers are the answer key,
 * so they must never reach the candidate's client. Only the prompt and any
 * read-only context do.
 */
export type ClientQuestion = Omit<DiscussionProblem, 'expectedPoints' | 'hintLadder'>

export function toClientQuestion(question: DiscussionProblem): ClientQuestion {
  const { expectedPoints: _expectedPoints, hintLadder: _hintLadder, ...rest } = question
  return rest
}
