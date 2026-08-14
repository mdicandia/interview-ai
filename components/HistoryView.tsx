'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import {
  byProblem,
  useHistory,
  type Attempt,
  type Outcome,
} from '@/lib/session/history'
import { formatDuration } from '@/lib/session/store'

/**
 * Every attempt, grouped by problem, oldest first.
 *
 * The thing worth seeing is the *shape* of a repeat, not a leaderboard: 40
 * minutes and four hints, then 22 and none, is the sentence this page exists to
 * write. So each problem shows its attempts in order rather than a best score,
 * and the deltas compare the latest against the first — progress is a direction,
 * and comparing against your best would hide a regression.
 */

const OUTCOME_LABEL: Record<Outcome, string> = {
  solved: 'Solved',
  partial: 'Partial',
  'not-solved': 'Not solved',
  abandoned: 'Abandoned',
}

const OUTCOME_STYLE: Record<Outcome, string> = {
  solved: 'border-pass/50 text-pass',
  partial: 'border-warn/50 text-warn',
  'not-solved': 'border-fail/50 text-fail',
  abandoned: 'border-surface-3 text-ink-2',
}

/** A signed change where *down* is the improvement. */
function Delta({ value, unit }: { value: number; unit: string }) {
  if (value === 0) return <span className="text-ink-2">no change</span>
  const better = value < 0
  return (
    <span className={better ? 'text-pass' : 'text-warn'}>
      {better ? '↓' : '↑'} {Math.abs(value)}
      {unit}
    </span>
  )
}

function AttemptRow({ attempt, index }: { attempt: Attempt; index: number }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-surface-3 py-2">
      <span className="w-6 shrink-0 font-mono text-[11px] text-ink-2">#{index + 1}</span>

      <span
        className={`shrink-0 rounded border px-1.5 py-px text-[10px] uppercase tracking-wide ${OUTCOME_STYLE[attempt.outcome]}`}
      >
        {OUTCOME_LABEL[attempt.outcome]}
      </span>

      {attempt.total !== undefined && (
        <span className="shrink-0 tabular-nums text-[12px] text-ink-1">
          {attempt.passed}/{attempt.total} tests
        </span>
      )}

      <span className="shrink-0 tabular-nums text-[12px] text-ink-1">
        {formatDuration(attempt.elapsedMs)}
      </span>

      <span className="shrink-0 text-[12px] text-ink-2">
        {attempt.hintsUsed === 0 ? 'no hints' : `${attempt.hintsUsed} hint${attempt.hintsUsed === 1 ? '' : 's'}`}
      </span>

      {attempt.solutionRevealed && (
        <span className="shrink-0 text-[12px] text-warn">read the solution</span>
      )}

      {!attempt.spokeAloud && <span className="shrink-0 text-[12px] text-ink-2">silent</span>}

      {attempt.content !== undefined && (
        <span className="shrink-0 text-[12px] text-ink-1">
          content {attempt.content}/5
          {attempt.delivery !== undefined ? ` · delivery ${attempt.delivery}/5` : ''}
        </span>
      )}

      <span className="ml-auto shrink-0 text-[11px] text-ink-2">
        {new Date(attempt.endedAt).toLocaleDateString()}
      </span>

      {attempt.note && (
        <span className="w-full text-[11.5px] leading-relaxed text-ink-2">{attempt.note}</span>
      )}
    </li>
  )
}

export function HistoryView() {
  const { attempts, loaded } = useHistory()
  const groups = useMemo(() => byProblem(attempts), [attempts])

  const totals = useMemo(() => {
    const solved = attempts.filter((a) => a.outcome === 'solved').length
    const attempted = attempts.filter((a) => a.outcome !== 'abandoned').length
    const spoken = attempts.filter((a) => a.spokeAloud).length
    return { solved, attempted, spoken, all: attempts.length }
  }, [attempts])

  return (
    <div className="min-h-screen bg-surface-0">
      <header className="flex items-center gap-4 border-b border-surface-3 bg-surface-1 px-6 py-3">
        <Link
          href="/"
          className="text-[13px] text-ink-2 transition-colors hover:text-ink-0"
          aria-label="Back to home"
        >
          ←
        </Link>
        <h1 className="text-[14px] font-medium text-ink-0">Progress</h1>
        {totals.all > 0 && (
          <p className="ml-auto text-[11.5px] text-ink-2">
            {totals.all} attempt{totals.all === 1 ? '' : 's'} · {totals.solved} solved ·{' '}
            {totals.spoken} spoken aloud
          </p>
        )}
      </header>

      <main className="mx-auto max-w-[900px] px-6 pb-20">
        {!loaded && <p className="py-16 text-[13px] text-ink-2">Reading your history…</p>}

        {loaded && groups.length === 0 && (
          <div className="py-16">
            <h2 className="mb-2 text-[15px] text-ink-0">Nothing recorded yet</h2>
            <p className="mb-5 max-w-[54ch] text-[13px] leading-relaxed text-ink-2">
              An attempt is written here when you end a session. Come back after a couple of
              rounds — a single one has nothing to compare against, which is the only thing
              this page is for.
            </p>
            <Link
              href="/"
              className="rounded-md bg-accent px-3.5 py-2 text-[12px] font-medium text-surface-0 transition-opacity hover:opacity-90"
            >
              Start a session
            </Link>
          </div>
        )}

        {loaded &&
          groups.map((group) => (
            <section key={group.slug} className="border-t border-surface-3 py-6 first:border-t-0">
              <header className="mb-2 flex flex-wrap items-baseline gap-3">
                <h2 className="text-[14.5px] text-ink-0">{group.title}</h2>
                <span className="text-[11.5px] text-ink-2">
                  {group.attempts.length} attempt{group.attempts.length === 1 ? '' : 's'}
                </span>

                {group.timeDeltaMs !== null && (
                  <span className="text-[12px]">
                    <span className="text-ink-2">time </span>
                    <Delta value={Math.round(group.timeDeltaMs / 60_000)} unit=" min" />
                  </span>
                )}
                {group.hintDelta !== null && (
                  <span className="text-[12px]">
                    <span className="text-ink-2">hints </span>
                    <Delta value={group.hintDelta} unit="" />
                  </span>
                )}

                <Link
                  href={
                    group.attempts[0].source === 'question'
                      ? `/question/${group.slug}`
                      : `/interview/${group.slug}`
                  }
                  className="ml-auto rounded border border-surface-3 px-2.5 py-1 text-[11.5px] text-ink-2 transition-colors hover:border-accent-dim hover:text-accent"
                >
                  {group.attempts.length > 1 ? 'Try again' : 'Retry this'}
                </Link>
              </header>

              <ul className="flex flex-col">
                {group.attempts.map((attempt, i) => (
                  <AttemptRow key={attempt.id} attempt={attempt} index={i} />
                ))}
              </ul>
            </section>
          ))}
      </main>
    </div>
  )
}
