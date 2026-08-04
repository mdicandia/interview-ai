'use client'

import { useRouter } from 'next/navigation'
import { formatDuration, useSession, useStageClock } from '@/lib/session/store'

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

  const move = (index: number) => {
    const next = session.stages[index]
    if (!next) return
    goToStage(index)
    router.push(next.source === 'question' ? `/question/${next.slug}` : `/interview/${next.slug}`)
  }

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-surface-3 bg-surface-2 px-4 py-1.5">
      <span className="shrink-0 text-[11px] uppercase tracking-wider text-ink-2">
        {session.name}
      </span>

      <div className="flex shrink-0 items-center gap-1" role="list" aria-label="Session stages">
        {session.stages.map((s, i) => (
          <button
            key={`${s.slug}-${i}`}
            type="button"
            onClick={() => move(i)}
            title={`${s.label} — ${s.title}`}
            aria-current={i === session.currentIndex}
            className={`h-1.5 w-6 rounded-full transition-colors ${
              i === session.currentIndex
                ? 'bg-accent'
                : i < session.currentIndex
                  ? 'bg-ink-2'
                  : 'bg-surface-3 hover:bg-ink-2'
            }`}
          />
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
        <span
          className={`tabular-nums text-[13px] ${
            overtime ? 'text-warn' : paused ? 'text-ink-2' : 'text-ink-0'
          }`}
          title={
            overtime
              ? 'Over the suggested time — nothing stops, this is just information'
              : 'Time remaining for this round'
          }
        >
          {formatDuration(remainingMs)}
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
            onClick={() => {
              finish()
              router.push('/')
            }}
            className="rounded bg-surface-3 px-2.5 py-0.5 text-[11px] text-ink-0 transition-opacity hover:opacity-80"
          >
            End session
          </button>
        ) : (
          <button
            type="button"
            onClick={() => move(session.currentIndex + 1)}
            className="rounded bg-accent px-2.5 py-0.5 text-[11px] font-medium text-surface-0 transition-opacity hover:opacity-90"
          >
            Next round
          </button>
        )}
      </div>
    </div>
  )
}
