'use client'

import { useRouter } from 'next/navigation'
import { formatDuration, stageElapsed, useSession, useStageClock } from '@/lib/session/store'
import { sealRecord } from '@/lib/session/record'

/**
 * The session strip above the interview room.
 *
 * Renders nothing when there's no active session, so a directly-linked problem
 * still works standalone exactly as before.
 *
 * The timer deliberately never ends a stage. It counts down, then keeps counting
 * into overtime in a warning colour. Running long is information worth seeing —
 * being cut off mid-thought teaches nothing, and this is practice.
 */
export function SessionBar() {
  const router = useRouter()
  const { session, goToStage, togglePause, finish } = useSession()
  const { remainingMs, overtime } = useStageClock(session)

  if (!session) return null

  const stage = session.stages[session.currentIndex]
  const isLast = session.currentIndex === session.stages.length - 1
  const paused = session.runningSince === null
  /** Five minutes over is a different situation from thirty seconds over. */
  const deepOvertime = overtime && Math.abs(remainingMs) > 5 * 60_000

  const move = (index: number) => {
    const next = session.stages[index]
    if (!next) return
    goToStage(index)
    router.push(next.source === 'question' ? `/question/${next.slug}` : `/interview/${next.slug}`)
  }

  /**
   * Ends the session and goes to the report.
   *
   * The clock has to be read *before* `finish()` clears the session, because
   * per-round timing is the one thing the evidence record cannot reconstruct on
   * its own — it does not know about pauses or revisited stages.
   */
  const end = () => {
    sealRecord(
      Object.fromEntries(session.stages.map((s, i) => [s.slug, stageElapsed(session, i)])),
    )
    finish()
    router.push('/report')
  }

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-surface-3 bg-surface-2 px-4 py-1.5">
      <span className="shrink-0 text-[11px] uppercase tracking-wider text-ink-2">
        {session.name}
      </span>

      <div className="flex shrink-0 items-center gap-1" role="list" aria-label="Session stages">
        {session.stages.map((s, i) => (
          /*
            A 24×6 target that navigates between rounds was both hard to hit and
            described only by a `title`, which a screen reader may never read.
            The pip stays 6px; the button around it is 24px tall.
          */
          <button
            key={`${s.slug}-${i}`}
            type="button"
            onClick={() => move(i)}
            title={`${s.label} — ${s.title}`}
            aria-label={`Go to round ${i + 1}: ${s.label} — ${s.title}`}
            aria-current={i === session.currentIndex ? 'step' : undefined}
            className="group flex h-6 w-6 items-center justify-center"
          >
            <span
              className={`h-1.5 w-6 rounded-full transition-colors ${
                i === session.currentIndex
                  ? 'bg-accent'
                  : i < session.currentIndex
                    ? 'bg-ink-2'
                    : 'bg-surface-3 group-hover:bg-ink-2'
              }`}
            />
          </button>
        ))}
      </div>

      <span className="min-w-0 truncate text-[12px] text-ink-1">
        <span className="text-ink-0">{stage.label}</span>
        <span className="text-ink-2">
          {' '}
          · {session.currentIndex + 1} of {session.stages.length}
        </span>
      </span>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/*
          Overtime escalates, because a 13px amber number reads the same at two
          minutes over and at twenty. Nothing here ever stops a round — the tint
          is information, not a deadline.
        */}
        <span
          className={`rounded px-1.5 py-0.5 tabular-nums text-[13px] transition-colors ${
            overtime
              ? deepOvertime
                ? 'bg-fail/15 text-fail'
                : 'bg-warn/10 text-warn'
              : paused
                ? 'text-ink-2'
                : 'text-ink-0'
          }`}
          title={
            overtime
              ? 'Over the suggested time — nothing stops, this is just information'
              : 'Time remaining for this round'
          }
        >
          {/* `formatDuration` prepends a minus for a negative value, and the
              word "over" says the same thing again: "-2:06 over". */}
          {formatDuration(overtime ? Math.abs(remainingMs) : remainingMs)}
          {overtime && <span className="ml-1 text-[11px]">over</span>}
        </span>

        <button
          type="button"
          onClick={togglePause}
          className="rounded border border-surface-3 px-2 py-0.5 text-[11px] text-ink-2 transition-colors hover:text-ink-0"
        >
          {paused ? 'Resume' : 'Pause'}
        </button>

        <button
          type="button"
          onClick={() => move(session.currentIndex - 1)}
          disabled={session.currentIndex === 0}
          className="rounded border border-surface-3 px-2 py-0.5 text-[11px] text-ink-2 transition-colors hover:text-ink-0 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Back
        </button>

        {isLast ? (
          <button
            type="button"
            onClick={end}
            className="rounded bg-surface-3 px-2.5 py-0.5 text-[11px] text-ink-0 transition-opacity hover:opacity-80"
          >
            End &amp; get report
          </button>
        ) : (
          /*
            A bordered button, not a filled accent one, and it confirms while
            the clock still has time on it.

            It sat 19px above "Run" in the same accent blue. Run is pressed
            dozens of times a round; this one ends the round. One misclick under
            time pressure and the work is behind you.
          */
          <button
            type="button"
            onClick={() => {
              if (!overtime && !window.confirm(`Leave "${stage.label}" and move to the next round?`)) {
                return
              }
              move(session.currentIndex + 1)
            }}
            className="rounded border border-surface-3 px-2.5 py-0.5 text-[11px] text-ink-1 transition-colors hover:border-accent-dim hover:text-accent"
          >
            Next round
          </button>
        )}
      </div>
    </div>
  )
}
