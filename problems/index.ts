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
 * The answer keys — `referenceSolution` for algorithm problems, `referencePatch`
 * for workspace ones — are stripped here, and that removal is real: problems are
 * loaded in a server component, so they never enter the client bundle.
 *
 * Everything else *does* ship to the browser, including hidden test cases, because
 * execution happens there in Pyodide / a Web Worker. `hidden` is therefore a
 * presentation flag, not a security boundary — an acceptable trade for a
 * single-user practice tool where nobody is adversarial against themselves. A
 * hosted version with real grading would have to run tests server-side instead.
 */
export type ClientAlgorithmProblem = Omit<AlgorithmProblem, 'referenceSolution'>
export type ClientWorkspaceProblem = Omit<WorkspaceProblem, 'referencePatch'>
export type ClientProblem = ClientAlgorithmProblem | ClientWorkspaceProblem

export function toClientProblem(problem: Problem): ClientProblem {
  if (problem.kind === 'workspace') {
    const { referencePatch: _referencePatch, ...rest } = problem
    return rest
  }
  const { referenceSolution: _referenceSolution, ...rest } = problem
  return rest
}
