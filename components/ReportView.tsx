'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AxisVerdict, DiagnosisKind, Report, RoundVerdict } from '@/server/interview/report'
import { hasEvidence, sealRecord, useRecord, type SessionRecord } from '@/lib/session/record'
import { attachScores } from '@/lib/session/history'

/**
 * The post-session report.
 *
 * Generation is cached against the record's id, because it is the one expensive
 * call in the app: `deepseek-v4-pro` with thinking on, half a minute of latency.
 * Coming back to re-read the report must not re-bill it, and — more importantly —
 * must not produce a *different* report from the one already read. Regenerating
 * is possible, but only when asked for explicitly.
 */

const CACHE_KEY = 'interview-ai:report:v1'

const OUTCOME_LABEL: Record<RoundVerdict['outcome'], string> = {
  solved: 'Solved',
  partial: 'Partly there',
  'not-solved': 'Not solved',
  'not-attempted': 'Not attempted',
}

const OUTCOME_STYLE: Record<RoundVerdict['outcome'], string> = {
  solved: 'border-pass/50 text-pass',
  partial: 'border-warn/50 text-warn',
  'not-solved': 'border-fail/50 text-fail',
  'not-attempted': 'border-surface-3 text-ink-2',
}

/**
 * The five readings, said in the second person.
 *
 * Spelled out rather than left as prose alone because this is the answer to the
 * question the whole two-axis rubric exists for: is this a language problem or a
 * knowledge problem? It should be readable at a glance.
 */
const DIAGNOSIS_LABEL: Record<DiagnosisKind, string> = {
  'expression-lags-knowledge': 'You knew it — you struggled to say it',
  'knowledge-lags-expression': 'You said it well — the knowledge was not behind it',
  'both-solid': 'Both solid',
  'both-weak': 'Both need work',
  'not-enough-evidence': 'Not enough was said to tell',
}

function readCached(recordId: string): Report | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { recordId: string; report: Report }
    return parsed.recordId === recordId ? parsed.report : null
  } catch {
    return null
  }
}

function writeCached(recordId: string, report: Report): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ recordId, report }))
  } catch {
    // Losing the cache only costs another generation; not worth failing over.
  }
}

/* --------------------------------------------------------------- fragments */

function Score({ axis, label }: { axis: AxisVerdict; label: string }) {
  return (
    <div className="flex-1 rounded-md border border-surface-3 bg-surface-1 px-3.5 py-3">
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[10px] uppercase tracking-wider text-ink-2">{label}</span>
        <span className="ml-auto flex gap-1" aria-label={`${axis.score} out of 5`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              className={`size-1.5 rounded-full ${n <= axis.score ? 'bg-accent' : 'bg-surface-3'}`}
            />
          ))}
        </span>
        <span className="text-[12px] tabular-nums text-ink-1">{axis.score}/5</span>
      </div>
      <p className="text-[12.5px] leading-relaxed text-ink-0">{axis.comment}</p>
    </div>
  )
}

function Bullets({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (items.length === 0) return null
  return (
    <div>
      <h4 className={`mb-1.5 text-[10px] uppercase tracking-wider ${tone}`}>{title}</h4>
      <ul className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-0">
            <span className="select-none text-ink-2">·</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Round({ round }: { round: RoundVerdict }) {
  return (
    <section className="border-t border-surface-3 py-7">
      <header className="mb-4 flex flex-wrap items-baseline gap-2.5">
        <h2 className="text-[15px] font-medium text-ink-0">{round.title}</h2>
        <span
          className={`rounded border px-1.5 py-px text-[10px] uppercase tracking-wide ${OUTCOME_STYLE[round.outcome]}`}
        >
          {OUTCOME_LABEL[round.outcome]}
        </span>
      </header>

      <div className="mb-4 flex flex-wrap gap-3">
        <Score axis={round.content} label="Content — what you knew" />
        {round.delivery ? (
          <Score axis={round.delivery} label="Delivery — how it landed" />
        ) : (
          <div className="flex-1 rounded-md border border-dashed border-surface-3 px-3.5 py-3">
            <div className="mb-1.5 text-[10px] uppercase tracking-wider text-ink-2">
              Delivery — how it landed
            </div>
            <p className="text-[12.5px] leading-relaxed text-ink-2">
              Not scored. You worked through this one in silence, so there is nothing to
              judge. Start the interviewer next time and this half of the report fills in.
            </p>
          </div>
        )}
      </div>

      {round.diagnosis && (
        <div className="mb-4 rounded-md border border-accent-dim/60 bg-accent-dim/10 px-4 py-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-accent">
            Language or knowledge?
          </div>
          {round.diagnosisKind && (
            <p className="mb-1.5 text-[13.5px] font-medium text-ink-0">
              {DIAGNOSIS_LABEL[round.diagnosisKind]}
            </p>
          )}
          <p className="text-[13px] leading-relaxed text-ink-1">{round.diagnosis}</p>
        </div>
      )}

      {round.moments.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 text-[10px] uppercase tracking-wider text-ink-2">
            Moments that mattered
          </h4>
          <ul className="flex flex-col gap-3">
            {round.moments.map((moment, i) => (
              <li key={i} className="border-l-2 border-surface-3 pl-3.5">
                <div className="mb-1 flex items-baseline gap-2">
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-2">
                    {moment.at}
                  </span>
                  {/* A description of an event is not put in quotation marks —
                      only what was actually said gets to look like a quote. */}
                  {moment.spoken ? (
                    <q className="text-[12.5px] italic leading-relaxed text-ink-1">
                      {moment.quote}
                    </q>
                  ) : (
                    <span className="text-[12.5px] leading-relaxed text-ink-2">{moment.quote}</span>
                  )}
                </div>
                <p className="text-[12.5px] leading-relaxed text-ink-0">{moment.comment}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Bullets title="What worked" items={round.didWell} tone="text-pass" />
        <Bullets title="Do differently" items={round.doDifferently} tone="text-warn" />
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------- page */

type Status = 'loading' | 'generating' | 'ready' | 'error' | 'empty'
type Outcome = { report: Report } | { error: string }

export function ReportView() {
  const { record, loaded } = useRecord()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  /** Bumped by Regenerate, which is the only thing that pays for a second run. */
  const [attempt, setAttempt] = useState(0)

  // Guards against StrictMode's double-invoked effect billing two generations
  // for the same session.
  const requested = useRef<string | null>(null)

  const load = useCallback(async (current: SessionRecord, force: boolean) => {
    const cached = force ? null : readCached(current.id)
    if (cached) {
      setOutcome({ report: cached })
      return
    }
    try {
      const response = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record: current }),
      })
      const payload = (await response.json()) as Report & { error?: string }
      if (!response.ok || payload.error) {
        setOutcome({ error: payload.error ?? 'The report could not be generated.' })
        return
      }
      writeCached(current.id, payload)
      // The scores belong in the permanent history too — they are the only
      // measure of whether the *explaining* is improving, which the pass/fail
      // counts cannot show.
      attachScores(
        current.id,
        payload.rounds.map((round) => ({
          slug: round.slug,
          content: round.content.score,
          delivery: round.delivery?.score ?? null,
          diagnosisKind: round.diagnosisKind,
        })),
      )
      setOutcome({ report: payload })
    } catch (e) {
      setOutcome({ error: e instanceof Error ? e.message : String(e) })
    }
  }, [])

  useEffect(() => {
    if (!loaded || !record || !hasEvidence(record)) return

    const key = `${record.id}:${attempt}`
    if (requested.current === key) return
    requested.current = key

    // Reaching this page ends the session, whether or not the session bar did it.
    // A problem opened directly never passes through "End & get report", so its
    // record is still open and carries no timings; sealing with an empty clock
    // falls back to wall-clock since the round was entered, which is the truth
    // for a single standalone round.
    const sealed = record.endedAt === null ? (sealRecord({}) ?? record) : record
    void load(sealed, attempt > 0)
  }, [attempt, load, loaded, record])

  const report = outcome && 'report' in outcome ? outcome.report : null
  const error = outcome && 'error' in outcome ? outcome.error : null

  const status: Status = !loaded
    ? 'loading'
    : !hasEvidence(record)
      ? 'empty'
      : report
        ? 'ready'
        : error
          ? 'error'
          : 'generating'

  const regenerate = useCallback(() => {
    setOutcome(null)
    setAttempt((n) => n + 1)
  }, [])

  return (
    <div className="min-h-screen bg-surface-0">
      <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-surface-3 bg-surface-1/95 px-6 py-3 backdrop-blur">
        <Link
          href="/"
          className="text-[13px] text-ink-2 transition-colors hover:text-ink-0"
          aria-label="Back to home"
        >
          ←
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-[14px] font-medium text-ink-0">
            {record?.name ?? 'Report'}
          </h1>
          {record?.endedAt && (
            <p className="text-[11px] text-ink-2">
              {new Date(record.endedAt).toLocaleString()} ·{' '}
              {record.rounds.length} round{record.rounds.length === 1 ? '' : 's'}
            </p>
          )}
        </div>
        {status === 'ready' && (
          <button
            type="button"
            onClick={regenerate}
            className="ml-auto rounded border border-surface-3 px-2.5 py-1 text-[11px] text-ink-2 transition-colors hover:text-ink-0"
          >
            Regenerate
          </button>
        )}
      </header>

      <main className="mx-auto max-w-[820px] px-6 pb-20">
        {status === 'loading' && <p className="py-16 text-[13px] text-ink-2">Reading the session…</p>}

        {status === 'empty' && (
          <div className="py-16">
            <h2 className="mb-2 text-[15px] text-ink-0">Nothing to report on</h2>
            <p className="mb-5 max-w-[54ch] text-[13px] leading-relaxed text-ink-2">
              No code, no test runs and no conversation were recorded. Work through a round
              first — the report is built from what actually happened, so an empty session
              would only produce invented feedback.
            </p>
            <Link
              href="/"
              className="rounded-md bg-accent px-3.5 py-2 text-[12px] font-medium text-surface-0 transition-opacity hover:opacity-90"
            >
              Start a session
            </Link>
          </div>
        )}

        {status === 'generating' && (
          <div className="py-16">
            <p className="mb-2 text-[14px] text-ink-0">Reading back the whole session…</p>
            <p className="max-w-[54ch] text-[12.5px] leading-relaxed text-ink-2">
              This uses the slow, careful model rather than the fast conversational one, and
              it is reading your transcript, every test run and your final code against the
              reference solution. Around half a minute.
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="py-16">
            <h2 className="mb-2 text-[15px] text-fail">The report failed</h2>
            <p className="mb-5 max-w-[64ch] break-words text-[12.5px] leading-relaxed text-ink-1">
              {error}
            </p>
            <button
              type="button"
              onClick={regenerate}
              className="rounded-md bg-accent px-3.5 py-2 text-[12px] font-medium text-surface-0 transition-opacity hover:opacity-90"
            >
              Try again
            </button>
          </div>
        )}

        {status === 'ready' && report && (
          <>
            {report.headline && (
              <p className="py-8 text-[17px] leading-relaxed text-ink-0">{report.headline}</p>
            )}

            {report.rounds.map((round) => (
              <Round key={round.slug} round={round} />
            ))}

            {(report.themes.length > 0 ||
              report.practice.length > 0 ||
              report.notAssessed.length > 0) && (
              <section className="border-t border-surface-3 py-7">
                <div className="flex flex-col gap-6">
                  <Bullets
                    title="Across the session"
                    items={report.themes}
                    tone="text-ink-2"
                  />
                  <Bullets title="Practise next" items={report.practice} tone="text-accent" />
                  {report.notAssessed.length > 0 && (
                    <div>
                      <h4 className="mb-1.5 text-[10px] uppercase tracking-wider text-ink-2">
                        Not assessed — no evidence either way
                      </h4>
                      <ul className="flex flex-col gap-1.5">
                        {report.notAssessed.map((item, i) => (
                          <li key={i} className="text-[12.5px] leading-relaxed text-ink-2">
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}
