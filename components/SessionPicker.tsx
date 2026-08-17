'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import type { CatalogueEntry, DrillEntry } from '@/lib/session/catalogue'
import { buildCustomSession, buildSession } from '@/lib/session/build'
import { SESSION_TEMPLATES, templateMinutes } from '@/lib/session/templates'
import { startSession, useSession } from '@/lib/session/store'
import { hasEvidence, useRecord } from '@/lib/session/record'
import { useHistory, type Outcome } from '@/lib/session/history'
import {
  DIFFICULTY_COLOR,
  DISCUSSION_FORMAT_LABELS,
  VARIANT_LABELS,
} from '@/lib/problems/types'

/** How the last attempt at a problem is badged in the list. */
const ATTEMPT_STYLE: Record<Outcome, string> = {
  solved: 'border-pass/40 text-pass',
  partial: 'border-warn/40 text-warn',
  'not-solved': 'border-fail/40 text-fail',
  abandoned: 'border-surface-3 text-ink-2',
}

function entryTag(entry: CatalogueEntry): string {
  if (entry.kind === 'workspace' && entry.variant) return VARIANT_LABELS[entry.variant]
  if (entry.kind === 'discussion' && entry.format) return DISCUSSION_FORMAT_LABELS[entry.format]
  return 'Algorithm'
}

export function SessionPicker({
  catalogue,
  drills,
}: {
  catalogue: CatalogueEntry[]
  drills: DrillEntry[]
}) {
  const router = useRouter()
  const { session, finish } = useSession()
  const { record } = useRecord()
  const { attempts } = useHistory()
  const [mode, setMode] = useState<'templates' | 'custom' | 'drills'>('templates')
  const [picked, setPicked] = useState<string[]>([])

  /** The most recent outcome per problem, so the list can show what you've done. */
  const lastOutcome = useMemo(() => {
    const latest: Record<string, Outcome> = {}
    for (const attempt of [...attempts].sort((a, b) => a.endedAt - b.endedAt)) {
      latest[attempt.slug] = attempt.outcome
    }
    return latest
  }, [attempts])

  const begin = (stages: { slug: string; source: 'problem' | 'question' }[], start: () => void) => {
    if (stages.length === 0) return
    start()
    const first = stages[0]
    router.push(first.source === 'question' ? `/question/${first.slug}` : `/interview/${first.slug}`)
  }

  const grouped = useMemo(
    () => ({
      practical: catalogue.filter((e) => e.kind === 'workspace'),
      algorithms: catalogue.filter((e) => e.kind === 'algorithm'),
      questions: catalogue.filter((e) => e.kind === 'discussion'),
    }),
    [catalogue],
  )

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-14">
      <header className="mb-8">
        <div className="flex items-baseline gap-4">
          <h1 className="text-xl font-medium text-ink-0">Live coding practice</h1>
          <button
            type="button"
            onClick={() => router.push('/history')}
            className="ml-auto rounded border border-surface-3 px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:border-accent-dim hover:text-accent"
          >
            Progress
          </button>
        </div>
        <p className="mt-1.5 text-[13px] text-ink-1">
          Run a full loop, or pick a single problem. Talk through it out loud — the
          interviewer listens, and the report afterwards is built from what you said.
        </p>
      </header>

      {session && (
        <div className="mb-8 flex items-center gap-3 rounded-lg border border-accent-dim bg-accent-dim/10 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-ink-0">
              {session.name} — round {session.currentIndex + 1} of {session.stages.length}
            </div>
            <div className="truncate text-[11.5px] text-ink-2">
              {session.stages[session.currentIndex]?.title}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const stage = session.stages[session.currentIndex]
              router.push(
                stage.source === 'question' ? `/question/${stage.slug}` : `/interview/${stage.slug}`,
              )
            }}
            className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-surface-0"
          >
            Resume
          </button>
          <button
            type="button"
            onClick={finish}
            className="shrink-0 rounded-md border border-surface-3 px-3 py-1.5 text-[12px] text-ink-2 hover:text-ink-0"
          >
            Discard
          </button>
        </div>
      )}

      {/*
        Offered whenever there is evidence to report on, session or not. A single
        problem opened directly never passes through "End & get report", and that
        is the most common way to practise one round.
      */}
      {!session && hasEvidence(record) && (
        <div className="mb-8 flex items-center gap-3 rounded-lg border border-surface-3 bg-surface-1 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-ink-0">Your last session is unreported</div>
            <div className="truncate text-[11.5px] text-ink-2">
              {record!.rounds.map((r) => r.title).join(' · ')}
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push('/report')}
            className="shrink-0 rounded-md border border-accent-dim px-3 py-1.5 text-[12px] text-accent hover:bg-accent-dim/10"
          >
            See the report
          </button>
        </div>
      )}

      <div className="mb-5 flex gap-1 self-start rounded-md border border-surface-3 p-0.5">
        {(
          [
            ['templates', 'Interview formats'],
            ['custom', 'Build your own'],
            ['drills', 'Rapid fire'],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded px-3 py-1 text-[12px] transition-colors ${
              mode === m ? 'bg-surface-3 text-ink-0' : 'text-ink-2 hover:text-ink-1'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/*
        A third tab rather than more rows in "Build your own". A drill is not a
        session stage — it has its own room, its own clock and its own grading
        pass — so it cannot be checked into a list whose whole purpose is
        composing stages, and pretending otherwise would mean teaching the
        session store about a second kind of timer.
      */}
      {mode === 'drills' ? (
        <div>
          <p className="mb-4 text-[12.5px] leading-relaxed text-ink-1">
            Ten questions, sixty seconds each, no follow-ups. This is the screening
            format rather than the interview one, and it trains a different thing:
            recall under time pressure, with nobody helping you get there.
          </p>
          <ul className="flex flex-col gap-2">
            {drills.map((drill) => (
              <li key={drill.slug}>
                <div className="rounded-lg border border-surface-3 bg-surface-1 px-4 py-3.5">
                  <div className="flex items-baseline gap-3">
                    <h2 className="text-[14px] text-ink-0">{drill.title}</h2>
                    {lastOutcome[drill.slug] && (
                      <span
                        className={`shrink-0 rounded border px-1.5 py-px text-[9.5px] uppercase tracking-wide ${
                          ATTEMPT_STYLE[lastOutcome[drill.slug]]
                        }`}
                        title={`Last run: ${lastOutcome[drill.slug]}`}
                      >
                        {lastOutcome[drill.slug] === 'solved' ? 'done' : lastOutcome[drill.slug]}
                      </span>
                    )}
                    <span
                      className={`ml-auto shrink-0 text-[10.5px] uppercase ${DIFFICULTY_COLOR[drill.difficulty]}`}
                    >
                      {drill.difficulty}
                    </span>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-1">{drill.blurb}</p>
                  <div className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-ink-2">
                    <span>
                      {drill.questionCount} questions · {drill.seconds}s each
                    </span>
                    <span>~{Math.round((drill.questionCount * (drill.seconds + 8)) / 60)} min</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => router.push(`/drill/${drill.slug}`)}
                    aria-label={`Start ${drill.title}`}
                    className="mt-3 rounded-md bg-accent px-3.5 py-2 text-[12px] font-medium text-surface-0 transition-opacity hover:opacity-90"
                  >
                    Start
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : mode === 'templates' ? (
        <ul className="flex flex-col gap-2">
          {SESSION_TEMPLATES.map((template) => {
            const built = buildSession(template, catalogue)
            const short = built.stages.length < template.stages.length
            return (
              <li key={template.id}>
                <div className="rounded-lg border border-surface-3 bg-surface-1 px-4 py-3.5">
                  <div className="flex items-baseline gap-3">
                    <h2 className="text-[14px] text-ink-0">{template.name}</h2>
                    <span className="ml-auto shrink-0 text-[11px] text-ink-2">
                      {template.stages.length} rounds · ~{templateMinutes(template)} min
                    </span>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-1">
                    {template.description}
                  </p>

                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {template.stages.map((stage, i) => (
                      <span
                        key={`${stage.label}-${i}`}
                        className="rounded border border-surface-3 px-1.5 py-0.5 text-[10.5px] text-ink-2"
                      >
                        {stage.label} · {stage.minutes}m
                      </span>
                    ))}
                  </div>

                  {template.omits && (
                    <p className="mt-2 text-[11px] text-ink-2">Not covered: {template.omits}</p>
                  )}
                  {short && (
                    <p className="mt-2 text-[11px] text-warn">
                      Only {built.stages.length} of {template.stages.length} rounds can be
                      filled — not enough problems of the right type yet.
                    </p>
                  )}

                  <button
                    type="button"
                    disabled={built.stages.length === 0}
                    onClick={() => {
                      // Rebuilt at click time so the random pick is fresh rather
                      // than whatever was rendered.
                      const fresh = buildSession(template, catalogue)
                      begin(fresh.stages, () => startSession(fresh))
                    }}
                    // Nine buttons on this screen whose accessible name was
                    // exactly "Start" — unusable from a screen reader's element
                    // list, where the surrounding card is not read.
                    aria-label={`Start ${template.name}`}
                    className="mt-3 rounded-md bg-accent px-3.5 py-2 text-[12px] font-medium text-surface-0 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Start
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <div>
          <p className="mb-4 text-[12.5px] text-ink-1">
            Pick the rounds you want, in the order you want them. Coding rounds get 45
            minutes; questions use their own suggested length.
          </p>

          {(
            [
              ['Practical', grouped.practical],
              ['Algorithms', grouped.algorithms],
              ['Questions (no coding)', grouped.questions],
            ] as const
          ).map(([label, entries]) => (
            <section key={label} className="mb-5">
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-2">
                {label}
              </h2>
              <ul className="flex flex-col gap-1">
                {entries.map((entry) => {
                  const order = picked.indexOf(entry.slug)
                  const selected = order !== -1
                  return (
                    <li key={entry.slug}>
                      <button
                        type="button"
                        onClick={() =>
                          setPicked((current) =>
                            selected
                              ? current.filter((s) => s !== entry.slug)
                              : [...current, entry.slug],
                          )
                        }
                        className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                          selected
                            ? 'border-accent-dim bg-accent-dim/10'
                            : 'border-surface-3 bg-surface-1 hover:border-ink-2'
                        }`}
                      >
                        <span
                          className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
                            selected ? 'bg-accent text-surface-0' : 'border border-surface-3 text-ink-2'
                          }`}
                        >
                          {selected ? order + 1 : ''}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] text-ink-0">
                          {entry.title}
                        </span>
                        {/*
                          What happened last time, from the history you already
                          keep. Without it the picker cannot answer the question
                          you actually arrive with — "which of these have I not
                          done, and which did I do badly?" — while the data to
                          answer it sits one page away.
                        */}
                        {lastOutcome[entry.slug] && (
                          <span
                            className={`shrink-0 rounded border px-1.5 py-px text-[9.5px] uppercase tracking-wide ${
                              ATTEMPT_STYLE[lastOutcome[entry.slug]]
                            }`}
                            title={`Last attempt: ${lastOutcome[entry.slug]}`}
                          >
                            {lastOutcome[entry.slug] === 'solved' ? 'done' : lastOutcome[entry.slug]}
                          </span>
                        )}
                        <span className="shrink-0 text-[10.5px] text-ink-2">{entryTag(entry)}</span>
                        <span
                          className={`shrink-0 text-[10.5px] uppercase ${DIFFICULTY_COLOR[entry.difficulty]}`}
                        >
                          {entry.difficulty}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}

          {/*
            The bar floats over the list, so without trailing room it sat on top
            of the last two rows permanently — the two you can never scroll to.
          */}
          <div className="sticky bottom-4 mt-4 flex items-center gap-3 rounded-lg border border-surface-3 bg-surface-2 px-4 py-3">
            <span className="text-[12px] text-ink-1">
              {picked.length === 0
                ? 'Nothing selected yet'
                : `${picked.length} round${picked.length === 1 ? '' : 's'} selected`}
            </span>
            {picked.length > 0 && (
              <button
                type="button"
                onClick={() => setPicked([])}
                className="text-[11.5px] text-ink-2 hover:text-ink-0"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              disabled={picked.length === 0}
              onClick={() => {
                const built = buildCustomSession(picked, catalogue)
                begin(built.stages, () => startSession(built))
              }}
              className="ml-auto rounded-md bg-accent px-3.5 py-1.5 text-[12px] font-medium text-surface-0 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Start session
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
