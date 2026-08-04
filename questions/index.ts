import type { DiscussionProblem } from '@/lib/problems/types'
import { codeReviewPython } from './code-review-python'
import { codeReviewTypescript } from './code-review-typescript'
import { conceptDatabaseIndex, conceptRequestLifecycle, tradeoffQueueVsDirect } from './concepts'
import { diagnosisP99Regression, systemDesignUrlShortener } from './scenarios'

/**
 * The non-coding question bank.
 *
 * Deliberately kept out of `PROBLEMS` and out of the picker. These cannot be
 * practised yet: a verbal answer has no test suite, so the only thing that can
 * judge one is the interviewer, which does not exist. Shipping them into the UI
 * now would mean a screen that shows a question and does nothing.
 *
 * They are written and verified now because the rubric is the durable artefact —
 * when the interviewer lands it scores against `expectedPoints` directly, with no
 * rewrite of the bank.
 */
export const QUESTIONS: readonly DiscussionProblem[] = [
  codeReviewPython,
  codeReviewTypescript,
  conceptDatabaseIndex,
  conceptRequestLifecycle,
  tradeoffQueueVsDirect,
  diagnosisP99Regression,
  systemDesignUrlShortener,
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
