'use client'

import { useEffect, useState } from 'react'
import type { Language } from '@/lib/problems/types'
import type { DiagnosisKind } from '@/server/interview/report'
import type { RoundRecord, SessionRecord } from './record'

/**
 * Every attempt ever made, kept forever.
 *
 * Distinct from the evidence record, which holds one session in full detail and
 * is replaced when the next one starts. This is the opposite shape: a small row
 * per attempt, appended and never rewritten, so the useful question — "am I
 * getting better at this?" — has an answer that survives the session it was
 * asked in.
 *
 * A second attempt at the same problem is a *new row*, never an update. Watching
 * a bug squash go 40 minutes and three hints, then 22 minutes and none, is the
 * whole point; collapsing to a personal best would throw away the shape of the
 * improvement and keep only its endpoint.
 */

const STORAGE_KEY = 'interview-ai:history:v1'

export type Outcome = 'solved' | 'partial' | 'not-solved' | 'abandoned'

export interface Attempt {
  id: string
  slug: string
  title: string
  source: 'problem' | 'question'
  language: Language | null
  endedAt: number
  elapsedMs: number
  outcome: Outcome
  /** Absent when the tests were never run, or for a spoken round. */
  passed?: number
  total?: number
  hintsUsed: number
  solutionRevealed: boolean
  /** Whether the interviewer was connected and heard anything. */
  spokeAloud: boolean
  /** Attached later, when a report is generated for the session. */
  content?: number
  delivery?: number
  diagnosisKind?: DiagnosisKind
  /** Set when a row was entered by hand rather than observed. */
  note?: string
}

export function readHistory(): Attempt[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as Attempt[]) : []
  } catch {
    return []
  }
}

function write(attempts: Attempt[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(attempts))
  } catch {
    // History is worth keeping but never worth interrupting a round for.
  }
  window.dispatchEvent(new Event('interview-ai:history-changed'))
}

/**
 * Derives an outcome from what actually happened, not from how it felt.
 *
 * A round with no test run at all is `abandoned` rather than `not-solved` — you
 * cannot have failed something you never submitted, and conflating the two would
 * make the solve rate a measure of how often you opened a problem.
 */
function outcomeOf(round: RoundRecord): Outcome {
  const last = round.runs[round.runs.length - 1]
  if (!last) return 'abandoned'
  if (last.total > 0 && last.passed === last.total) return 'solved'
  return last.passed > 0 ? 'partial' : 'not-solved'
}

/**
 * Appends one row per round of a sealed session.
 *
 * Idempotent by round: sealing the same session twice — which the report page
 * can do — must not double every row.
 */
export function recordAttempts(record: SessionRecord): Attempt[] {
  const existing = readHistory()
  const seen = new Set(existing.map((a) => a.id))
  const added: Attempt[] = []

  for (const round of record.rounds) {
    const id = `${record.id}:${round.slug}`
    if (seen.has(id)) continue

    const last = round.runs[round.runs.length - 1]
    added.push({
      id,
      slug: round.slug,
      title: round.title,
      source: round.source,
      language: round.language,
      endedAt: record.endedAt ?? Date.now(),
      elapsedMs: round.elapsedMs,
      outcome: outcomeOf(round),
      ...(last ? { passed: last.passed, total: last.total } : {}),
      hintsUsed: round.hints.length,
      solutionRevealed: round.solutionRevealed === true,
      spokeAloud: round.transcript.length > 0,
    })
  }

  if (added.length === 0) return existing
  const next = [...existing, ...added].sort((a, b) => a.endedAt - b.endedAt)
  write(next)
  return next
}

/** Attaches report scores to the rows they belong to, once one is generated. */
export function attachScores(
  recordId: string,
  scores: { slug: string; content: number; delivery: number | null; diagnosisKind: DiagnosisKind | null }[],
): void {
  const attempts = readHistory()
  let changed = false

  for (const score of scores) {
    const row = attempts.find((a) => a.id === `${recordId}:${score.slug}`)
    if (!row) continue
    row.content = score.content
    if (score.delivery !== null) row.delivery = score.delivery
    if (score.diagnosisKind !== null) row.diagnosisKind = score.diagnosisKind
    changed = true
  }

  if (changed) write(attempts)
}

/** Adds a row by hand, for an attempt made before history existed. */
export function addAttempt(attempt: Omit<Attempt, 'id'> & { id?: string }): void {
  const attempts = readHistory()
  const id = attempt.id ?? `manual:${attempt.slug}:${attempt.endedAt}`
  if (attempts.some((a) => a.id === id)) return
  write([...attempts, { ...attempt, id }].sort((a, b) => a.endedAt - b.endedAt))
}

export function clearHistory(): void {
  write([])
}

/* ------------------------------------------------------------------ reading */

export interface ProblemProgress {
  slug: string
  title: string
  attempts: Attempt[]
  best: Outcome
  /** Negative means faster than the first attempt. Null with only one attempt. */
  timeDeltaMs: number | null
  hintDelta: number | null
}

const RANK: Record<Outcome, number> = {
  solved: 3,
  partial: 2,
  'not-solved': 1,
  abandoned: 0,
}

/**
 * Groups attempts by problem, oldest first, with the change since the first go.
 *
 * The deltas compare first against *most recent*, not against best. Improvement
 * is a direction, and picking your best run to compare against would report
 * progress that has since reversed.
 */
export function byProblem(attempts: Attempt[]): ProblemProgress[] {
  const groups = new Map<string, Attempt[]>()
  for (const attempt of attempts) {
    const group = groups.get(attempt.slug) ?? []
    group.push(attempt)
    groups.set(attempt.slug, group)
  }

  return [...groups.values()]
    .map((group) => {
      const ordered = [...group].sort((a, b) => a.endedAt - b.endedAt)
      const first = ordered[0]
      const latest = ordered[ordered.length - 1]
      const repeated = ordered.length > 1
      return {
        slug: first.slug,
        title: first.title,
        attempts: ordered,
        best: ordered.reduce<Outcome>(
          (best, a) => (RANK[a.outcome] > RANK[best] ? a.outcome : best),
          'abandoned',
        ),
        timeDeltaMs: repeated ? latest.elapsedMs - first.elapsedMs : null,
        hintDelta: repeated ? latest.hintsUsed - first.hintsUsed : null,
      }
    })
    .sort((a, b) => {
      const aLast = a.attempts[a.attempts.length - 1].endedAt
      const bLast = b.attempts[b.attempts.length - 1].endedAt
      return bLast - aLast
    })
}

export function useHistory(): { attempts: Attempt[]; loaded: boolean } {
  const [state, setState] = useState<{ attempts: Attempt[]; loaded: boolean }>({
    attempts: [],
    loaded: false,
  })

  useEffect(() => {
    const sync = () => setState({ attempts: readHistory(), loaded: true })
    sync()
    window.addEventListener('interview-ai:history-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('interview-ai:history-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return state
}
