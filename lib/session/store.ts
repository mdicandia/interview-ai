'use client'

import { useCallback, useEffect, useState } from 'react'
import type { BuiltSession, ResolvedStage } from './build'
import { beginRecord } from './record'

/**
 * The active session, persisted to localStorage.
 *
 * Persistence isn't a nice-to-have here: the interview room reloads whenever you
 * navigate between stages, and losing a 40-minute timer to a refresh would make
 * the whole feature untrustworthy.
 *
 * Time is stored as accumulated milliseconds per stage plus a `runningSince`
 * timestamp, rather than a tick count. A counter driven by setInterval drifts,
 * stops in background tabs, and is wrong after a reload; deriving elapsed time
 * from wall-clock timestamps is correct in all three cases.
 */

const STORAGE_KEY = 'interview-ai:session:v1'

export interface SessionState {
  templateId: string
  name: string
  stages: ResolvedStage[]
  currentIndex: number
  /** Accumulated ms per stage, excluding any currently-running interval. */
  elapsedMs: number[]
  /** Wall-clock ms when the current stage's timer started, or null if paused. */
  runningSince: number | null
  startedAt: number
}

function read(): SessionState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SessionState
    if (!Array.isArray(parsed?.stages) || parsed.stages.length === 0) return null
    return parsed
  } catch {
    return null
  }
}

function write(state: SessionState | null) {
  if (typeof window === 'undefined') return
  try {
    if (state) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // A full or disabled localStorage shouldn't take the session down; the
    // in-memory state still works for as long as the tab is open.
  }
  // Same-tab listeners: the native 'storage' event only fires in *other* tabs.
  window.dispatchEvent(new Event('interview-ai:session-changed'))
}

export function startSession(session: BuiltSession): SessionState {
  const state: SessionState = {
    templateId: session.templateId,
    name: session.name,
    stages: session.stages,
    currentIndex: 0,
    elapsedMs: session.stages.map(() => 0),
    runningSince: Date.now(),
    startedAt: Date.now(),
  }
  write(state)
  // Starting a session discards the previous session's evidence. The report from
  // it, if one was generated, has already been read by then.
  beginRecord(session.name)
  return state
}

export function endSession() {
  write(null)
}

/** Elapsed ms for a stage, including the interval currently in progress. */
export function stageElapsed(state: SessionState, index: number): number {
  const base = state.elapsedMs[index] ?? 0
  const isCurrent = index === state.currentIndex && state.runningSince !== null
  return isCurrent ? base + (Date.now() - state.runningSince!) : base
}

/** Banks the running interval into the accumulated total. */
function settleClock(state: SessionState): SessionState {
  if (state.runningSince === null) return state
  const elapsedMs = [...state.elapsedMs]
  elapsedMs[state.currentIndex] =
    (elapsedMs[state.currentIndex] ?? 0) + (Date.now() - state.runningSince)
  return { ...state, elapsedMs, runningSince: null }
}

export function useSession() {
  const [state, setState] = useState<SessionState | null>(null)

  // Read after mount rather than during render: the server has no localStorage,
  // and initialising from it directly would produce a hydration mismatch.
  useEffect(() => {
    const sync = () => setState(read())
    sync()
    window.addEventListener('interview-ai:session-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('interview-ai:session-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const update = useCallback((next: SessionState | null) => {
    write(next)
    setState(next)
  }, [])

  /*
   * These read storage directly rather than going through a `setState` updater.
   *
   * `write` dispatches a change event synchronously, and every other mounted
   * `useSession` answers it by calling `setState`. Done from inside an updater —
   * which React may run during a render pass — that is a state update to one
   * component while a different one is rendering, and React says so:
   *
   *   Cannot update a component (`InterviewRoom`) while rendering a different
   *   component (`SessionBar`).
   *
   * Storage is the source of truth anyway, so reading it is not a workaround.
   * Both of these only ever run from a click handler, where a synchronous write
   * and broadcast is exactly right.
   */
  const goToStage = useCallback((index: number) => {
    const current = read()
    if (!current || index < 0 || index >= current.stages.length) return
    const settled = settleClock(current)
    // Moving to a new stage starts its clock; the previous stage's time is
    // banked and stays visible in the session summary.
    const next = { ...settled, currentIndex: index, runningSince: Date.now() }
    write(next)
    setState(next)
  }, [])

  const togglePause = useCallback(() => {
    const current = read()
    if (!current) return
    const next =
      current.runningSince === null
        ? { ...current, runningSince: Date.now() }
        : settleClock(current)
    write(next)
    setState(next)
  }, [])

  const finish = useCallback(() => {
    endSession()
    setState(null)
  }, [])

  return { session: state, setSession: update, goToStage, togglePause, finish }
}

/**
 * A ticking clock for the current stage.
 *
 * Returns *signed* remaining ms: negative means overtime. Nothing here ever ends
 * a stage — this is practice, and being cut off mid-thought teaches nothing. The
 * overrun is worth seeing, which is why it keeps counting rather than clamping
 * at zero.
 */
export function useStageClock(session: SessionState | null): {
  elapsedMs: number
  remainingMs: number
  overtime: boolean
} {
  const [, forceTick] = useState(0)

  const running = session?.runningSince !== null && session !== null

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [running])

  if (!session) return { elapsedMs: 0, remainingMs: 0, overtime: false }

  const stage = session.stages[session.currentIndex]
  const elapsedMs = stageElapsed(session, session.currentIndex)
  const remainingMs = stage.minutes * 60_000 - elapsedMs

  return { elapsedMs, remainingMs, overtime: remainingMs < 0 }
}

/** mm:ss, with a leading minus while in overtime. */
export function formatDuration(ms: number): string {
  const sign = ms < 0 ? '-' : ''
  const total = Math.floor(Math.abs(ms) / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${sign}${minutes}:${String(seconds).padStart(2, '0')}`
}
