import type { AlgorithmProblem, Problem, WorkspaceProblem } from '@/lib/problems/types'
import { longestSubstring } from './longest-substring'
import { mergeIntervals } from './merge-intervals'
import { twoSum } from './two-sum'
import { autocompleteBuild } from './autocomplete-build'
import { flakyRetry } from './flaky-retry'
import { idempotentCharge } from './idempotent-charge'
import { nPlusOneQueries } from './n-plus-one-queries'
import { orderPricing } from './order-pricing'
import { rateLimiterWindow } from './rate-limiter-window'
import { salesReportSql } from './sales-report-sql'
import { staleCounter } from './stale-counter'
import { webhookLedger } from './webhook-ledger'

/**
 * Practical rounds first — they're what most non-MAG7 loops actually run, and the
 * algorithm set is the thing you drill separately.
 */
export const PROBLEMS: readonly Problem[] = [
  flakyRetry,
  salesReportSql,
  idempotentCharge,
  nPlusOneQueries,
  staleCounter,
  autocompleteBuild,
  webhookLedger,
  rateLimiterWindow,
  orderPricing,
  twoSum,
  longestSubstring,
  mergeIntervals,
]

const BY_SLUG = new Map(PROBLEMS.map((p) => [p.slug, p]))

export function getProblem(slug: string): Problem | undefined {
  return BY_SLUG.get(slug)
}

/**
 * The shape sent from the server component down to the browser.
 *
 * The answer keys are stripped here, and the removal is real: problems are
 * loaded in a server component, so what is dropped never enters the page.
 *
 * `hintLadder` is one of them, which is less obvious than the reference
 * solution. It was shipping in full until `verify:bundle` went looking: every
 * rung, including the last and most explicit one, sat in the prerendered HTML of
 * every problem page. Two things were wrong with that. The ladder is meant to be
 * walked one rung at a time through `/api/hint`, and the report counts the rungs
 * taken — so reading the lot from the network tab both spoils the exercise and
 * records a clean run with no hints. Nothing on the client ever read it.
 *
 * Everything else *does* ship to the browser, including hidden test cases, because
 * execution happens there in Pyodide / a Web Worker. `hidden` is therefore a
 * presentation flag, not a security boundary — an acceptable trade for a
 * single-user practice tool where nobody is adversarial against themselves. A
 * hosted version with real grading would have to run tests server-side instead.
 */
export type ClientAlgorithmProblem = Omit<AlgorithmProblem, 'referenceSolution' | 'hintLadder'>
export type ClientWorkspaceProblem = Omit<WorkspaceProblem, 'referencePatch' | 'hintLadder'>
export type ClientProblem = ClientAlgorithmProblem | ClientWorkspaceProblem

export function toClientProblem(problem: Problem): ClientProblem {
  if (problem.kind === 'workspace') {
    const { referencePatch: _referencePatch, hintLadder: _hintLadder, ...rest } = problem
    return rest
  }
  const { referenceSolution: _referenceSolution, hintLadder: _hintLadder, ...rest } = problem
  return rest
}
