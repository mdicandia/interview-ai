'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import {
  axisTrend,
  byProblem,
  useHistory,
  type Attempt,
  type AxisTrend,
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

/** A five-pip score, so content and delivery are comparable at a glance. */
function Pips({ score, label }: { score: number; label: string }) {
  return (
    <span className="flex items-center gap-1" title={`${label} ${score} of 5`}>
      <span className="text-[10.5px] uppercase tracking-wide text-ink-2">{label}</span>
      <span className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            className={`size-1 rounded-full ${n <= score ? 'bg-accent' : 'bg-surface-3'}`}
          />
        ))}
      </span>
    </span>
  )
}

/**
 * The two axes over time, and the sentence they add up to.
 *
 * The whole reason content and delivery are scored apart is to tell "I don't
 * know this" from "I know it and can't say it yet". A single round cannot answer
 * that; a run of them can, and this is the only place that asks.
 *
 * Deliberately plain about uncertainty. Under six scored attempts it shows the
 * shape and says the deltas do not mean anything yet, rather than reporting a
 * trend from three points — a practice tool that flatters you is useless.
 */
function AxisTrendPanel({ trend }: { trend: AxisTrend }) {
  const { points, contentDelta, deliveryDelta, enough, gap } = trend
  if (points.length < 2) return null

  const H = 34
  const W = 240
  const step = points.length > 1 ? W / (points.length - 1) : 0
  // Scores are 1–5, so the axis is fixed rather than fitted. A fitted axis would
  // turn a flat run of 4s into a dramatic-looking line.
  const y = (score: number) => H - ((score - 1) / 4) * H
  const path = (pick: (p: (typeof points)[number]) => number | null) => {
    const drawn = points
      .map((p, i) => ({ x: i * step, value: pick(p) }))
      .filter((p): p is { x: number; value: number } => p.value !== null)
    if (drawn.length < 2) return null
    return drawn.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ')
  }

  const contentPath = path((p) => p.content)
  const deliveryPath = path((p) => p.delivery)

  const reading =
    !enough || contentDelta === null
      ? `Too few scored rounds to call a direction yet — ${points.length} so far, and it takes about six.`
      : gap !== null && gap <= -0.75
        ? 'Your delivery scores sit below your content scores: you know more than you are getting across.'
        : gap !== null && gap >= 0.75
          ? 'You put things across better than you know them — the gap to close is the material, not the English.'
          : 'Content and delivery are moving together.'

  return (
    <section className="mb-3 rounded-lg border border-surface-3 bg-surface-1/40 px-4 py-3.5">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-[13px] text-ink-0">Knowing it, and saying it</h2>
        <span className="text-[11px] text-ink-2">{points.length} scored rounds</span>
        {enough && (
          <span className="ml-auto flex items-center gap-3 text-[11.5px]">
            <span className="text-ink-2">
              content <TrendDelta value={contentDelta} />
            </span>
            <span className="text-ink-2">
              delivery <TrendDelta value={deliveryDelta} />
            </span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-[34px] w-[240px] shrink-0 overflow-visible"
          aria-hidden
        >
          {contentPath && (
            <path d={contentPath} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" />
          )}
          {deliveryPath && (
            <path
              d={deliveryPath}
              fill="none"
              stroke="var(--color-warn)"
              strokeWidth="1.5"
              strokeDasharray="3 2"
            />
          )}
        </svg>
        <div className="flex flex-col gap-1 text-[10.5px]">
          <span className="flex items-center gap-1.5 text-ink-2">
            <span className="h-px w-4 bg-accent" /> content
          </span>
          <span className="flex items-center gap-1.5 text-ink-2">
            <span className="h-px w-4 border-t border-dashed border-warn" /> delivery
          </span>
        </div>
      </div>

      <p className="mt-3 max-w-[62ch] text-[12px] leading-relaxed text-ink-1">{reading}</p>
    </section>
  )
}

/** Here, unlike everywhere else on this page, *up* is the improvement. */
function TrendDelta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-ink-2">—</span>
  if (Math.abs(value) < 0.25) return <span className="text-ink-2">flat</span>
  return (
    <span className={value > 0 ? 'text-pass' : 'text-fail'}>
      {value > 0 ? '↑' : '↓'} {Math.abs(value).toFixed(1)}
    </span>
  )
}

function AttemptRow({ attempt, index }: { attempt: Attempt; index: number }) {
  // A spoken round counts objectives; a coding round counts tests. Same slots.
  const unit = attempt.source === 'question' ? 'points' : 'tests'
  const ratio =
    attempt.total !== undefined && attempt.total > 0 ? (attempt.passed ?? 0) / attempt.total : null

  return (
    <li className="group grid grid-cols-[auto_7rem_1fr_auto] items-center gap-x-4 rounded-md px-3 py-2.5 transition-colors hover:bg-surface-1">
      <span className="font-mono text-[11px] text-ink-2">#{index + 1}</span>

      <span
        className={`justify-self-start rounded border px-1.5 py-px text-[10px] uppercase tracking-wide ${OUTCOME_STYLE[attempt.outcome]}`}
      >
        {OUTCOME_LABEL[attempt.outcome]}
      </span>

      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        {ratio !== null && (
          <span className="flex items-center gap-1.5">
            {/* A bar rather than a fraction: the shape of a repeat reads faster. */}
            <span className="h-1 w-16 overflow-hidden rounded-full bg-surface-3">
              <span
                className={`block h-full rounded-full ${ratio === 1 ? 'bg-pass' : 'bg-warn'}`}
                style={{ width: `${Math.round(ratio * 100)}%` }}
              />
            </span>
            <span className="tabular-nums text-[11.5px] text-ink-1">
              {attempt.passed}/{attempt.total} {unit}
            </span>
          </span>
        )}

        <span className="tabular-nums text-[11.5px] text-ink-1">
          {formatDuration(attempt.elapsedMs)}
        </span>

        {attempt.hintsUsed > 0 && (
          <span className="text-[11.5px] text-ink-2">
            {attempt.hintsUsed} hint{attempt.hintsUsed === 1 ? '' : 's'}
          </span>
        )}

        {attempt.verdict && (
          <span className="text-[11.5px] text-ink-2">verdict {attempt.verdict}</span>
        )}

        {attempt.solutionRevealed && (
          <span className="text-[11.5px] text-warn">read the solution</span>
        )}

        {attempt.source === 'problem' && !attempt.spokeAloud && (
          <span className="text-[11.5px] text-ink-2">silent</span>
        )}

        {attempt.content !== undefined && <Pips score={attempt.content} label="content" />}
        {attempt.delivery !== undefined && <Pips score={attempt.delivery} label="delivery" />}
      </span>

      <span className="justify-self-end text-[11px] text-ink-2">
        {new Date(attempt.endedAt).toLocaleDateString()}
      </span>

      {attempt.note && (
        <span className="col-span-4 mt-1 text-[11.5px] leading-relaxed text-ink-2">
          {attempt.note}
        </span>
      )}
    </li>
  )
}

export function HistoryView() {
  const { attempts, loaded } = useHistory()
  const groups = useMemo(() => byProblem(attempts), [attempts])
  const trend = useMemo(() => axisTrend(attempts), [attempts])

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
          <div className="ml-auto flex items-baseline gap-4 text-[11.5px]">
            <span className="text-ink-1">
              <span className="tabular-nums text-ink-0">{totals.all}</span> attempts
            </span>
            <span className="text-ink-1">
              <span className="tabular-nums text-pass">{totals.solved}</span> solved
            </span>
            <span className="text-ink-1">
              <span className="tabular-nums text-accent">{totals.spoken}</span> spoken aloud
            </span>
          </div>
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

        {loaded && groups.length > 0 && <AxisTrendPanel trend={trend} />}

        {loaded &&
          groups.map((group) => (
            <section
              key={group.slug}
              className="mb-3 overflow-hidden rounded-lg border border-surface-3 bg-surface-1/40"
            >
              <header className="flex flex-wrap items-baseline gap-3 border-b border-surface-3 px-4 py-3">
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

              <ul className="flex flex-col divide-y divide-surface-3/60 p-1">
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
