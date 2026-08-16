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
  /** The interviewer's own call on a spoken round. */
  verdict?: 'strong' | 'solid' | 'mixed' | 'weak'
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
/**
 * Did the candidate actually say anything?
 *
 * The transcript holds both speakers, so its length answers a different question
 * — "was the interviewer connected" — and using it here quietly gave credit for
 * sitting in silence while the interviewer talked.
 */
function spokeAloud(round: RoundRecord): boolean {
  return round.transcript.some((line) => line.role === 'candidate')
}

function outcomeOf(round: RoundRecord): Outcome {
  /*
   * A spoken round runs no tests, so the code path below would file every one of
   * them as `abandoned` — a twenty-minute interview that went well was recorded
   * as if it had never been opened. Coverage of the expected points is the
   * equivalent signal, and the interviewer tallies it live.
   */
  if (round.source === 'question') {
    const objectives = round.objectives
    if (!objectives || objectives.total === 0) {
      // Nothing tallied. Talking at all is more than abandoning it — but it has
      // to be *them* talking. The transcript holds both sides, so counting its
      // length credited a silent round for the interviewer's own opening line.
      return spokeAloud(round) ? 'partial' : 'abandoned'
    }
    if (objectives.covered >= objectives.essential && objectives.essential > 0) return 'solved'
    return objectives.covered > 0 ? 'partial' : 'not-solved'
  }

  const last = round.runs[round.runs.length - 1]
  if (!last) return 'abandoned'
  if (last.total > 0 && last.passed === last.total) return 'solved'
  return last.passed > 0 ? 'partial' : 'not-solved'
}

/**
 * Writes one row per round of a session, updating rows it has already written.
 *
 * **Upsert, not append**, and called on leaving a round as well as on ending the
 * session. Waiting for the session to be sealed meant a round was only ever
 * recorded if you finished the whole loop and pressed the right button — so
 * closing the tab, or the dev server dying mid-session, threw the work away.
 * Progress you lose by navigating is progress the tool did not actually keep.
 *
 * The row id is `session:slug`, so a later call for the same round overwrites
 * with better numbers rather than duplicating. That does not break the rule that
 * a *repeat attempt* is a new row: a repeat happens in a different session and
 * therefore gets a different id.
 */
export function recordAttempts(record: SessionRecord, activeSlug?: string): Attempt[] {
  const attempts = readHistory()
  // Sealing stamps authoritative per-round timings; before that they are
  // estimates, and an estimate must only ever be made once. See below.
  const sealed = record.endedAt !== null
  let changed = false

  for (const round of record.rounds) {
    const id = `${record.id}:${round.slug}`
    const last = round.runs[round.runs.length - 1]

    const row: Attempt = {
      id,
      slug: round.slug,
      title: round.title,
      source: round.source,
      language: round.language,
      endedAt: record.endedAt ?? Date.now(),
      // Sealing fills `elapsedMs`; until then fall back to wall clock, which is
      // correct only at the moment the round is left.
      elapsedMs: round.elapsedMs > 0 ? round.elapsedMs : Date.now() - round.enteredAt,
      outcome: outcomeOf(round),
      ...(last ? { passed: last.passed, total: last.total } : {}),
      // A spoken round reports coverage in the same two slots the test counts
      // use, so the history renders one row shape rather than two.
      ...(round.source === 'question' && round.objectives
        ? { passed: round.objectives.covered, total: round.objectives.total }
        : {}),
      ...(round.concluded ? { verdict: round.concluded.verdict } : {}),
      hintsUsed: round.hints.length,
      solutionRevealed: round.solutionRevealed === true,
      spokeAloud: spokeAloud(round),
    }

    const index = attempts.findIndex((a) => a.id === id)
    if (index === -1) {
      attempts.push(row)
      changed = true
      continue
    }

    /*
     * Timings are frozen at the first write; everything else is refreshed.
     *
     * A checkpoint walks *every* round in the record, not just the one being
     * left, so leaving round three re-derives round one. Recomputing
     * `Date.now() - enteredAt` there charges round one for the whole session:
     * a ten-minute round recorded as forty-five, permanently, if the session is
     * never sealed. `endedAt` had the same problem, collapsing every round of a
     * session onto the same instant and destroying their order.
     *
     * The first write for a round happens as it is left, so the frozen value is
     * the accurate one. Sealing is the exception — it carries real per-stage
     * timings from the session clock, including pauses.
     */
    /*
     * Refreshed only for the round being left, or when sealing.
     *
     * Freezing on the very first write was wrong in the other direction:
     * StrictMode mounts, unmounts and remounts, so the first checkpoint fires
     * milliseconds after entering and froze the duration at 0:00 forever. And
     * refreshing *every* round on every checkpoint was the original bug —
     * leaving round three recharged round one for the whole session.
     *
     * Scoping to the active round gives both: the round you are leaving gets a
     * correct final duration, and the ones you left earlier keep theirs.
     */
    const previous = attempts[index]
    const refresh = sealed || round.slug === activeSlug
    const merged: Attempt = {
      ...row,
      endedAt: refresh ? row.endedAt : previous.endedAt,
      elapsedMs: refresh ? row.elapsedMs : previous.elapsedMs,
      // Scores arrive later, from the report, and must survive a re-checkpoint.
      content: previous.content,
      delivery: previous.delivery,
      diagnosisKind: previous.diagnosisKind,
    }

    // Compared rather than assumed: a checkpoint that changes nothing should not
    // write and broadcast, which would re-render every history listener.
    if (JSON.stringify(merged) === JSON.stringify(previous)) continue
    attempts[index] = merged
    changed = true
  }

  if (!changed) return attempts
  const next = [...attempts].sort((a, b) => a.endedAt - b.endedAt)
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

/**
 * Adds a row by hand, for an attempt made before history existed.
 *
 * Intentionally has no caller. It is the console escape hatch — safer than
 * writing localStorage directly, because it dedupes on id and keeps the array
 * sorted. A UI for it would be a permanent affordance for a one-off need, and
 * a button that inserts an attempt you did not make is worse than no button.
 */
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

/**
 * How the two axes have moved over the scored attempts.
 *
 * This is the question the whole two-axis rubric was built to answer, and until
 * now nothing asked it: *is my English getting less in the way?* A per-attempt
 * pair of scores cannot say. Three months of them can.
 *
 * Only scored attempts count — a round done in silence has no delivery score,
 * and treating its absence as a zero would invent a decline. `delta` compares
 * the mean of the most recent third against the mean of the first third, which
 * is noisy at four attempts and meaningful by fifteen; `enough` says which.
 */
export interface AxisTrend {
  points: { at: number; content: number; delivery: number | null }[]
  contentDelta: number | null
  deliveryDelta: number | null
  /** True once there are enough scored attempts for the deltas to mean anything. */
  enough: boolean
  /**
   * Gap over the most recent window, delivery minus content. Negative means
   * expression is the lag.
   *
   * Recent, not lifetime. A lifetime mean cannot ever say "this used to be the
   * problem and now it is not" — it kept reporting "you know more than you are
   * getting across" while the deltas beside it showed delivery climbing and the
   * gap closed. The panel was contradicting its own numbers.
   */
  gap: number | null
  /** The same gap over the earliest window, so the reading can name a change. */
  gapWas: number | null
}

const MIN_FOR_TREND = 6

export function axisTrend(attempts: Attempt[]): AxisTrend {
  const scored = attempts
    .filter((a) => a.content !== undefined)
    .sort((a, b) => a.endedAt - b.endedAt)
    .map((a) => ({ at: a.endedAt, content: a.content!, delivery: a.delivery ?? null }))

  const mean = (values: number[]) =>
    values.length === 0 ? null : values.reduce((sum, n) => sum + n, 0) / values.length

  // A third at each end, so the comparison is between periods rather than
  // between two individual rounds — one bad morning should not read as a trend.
  const window = Math.max(1, Math.floor(scored.length / 3))
  const first = scored.slice(0, window)
  const last = scored.slice(-window)

  const delta = (pick: (p: (typeof scored)[number]) => number | null) => {
    const before = mean(first.map(pick).filter((n): n is number => n !== null))
    const after = mean(last.map(pick).filter((n): n is number => n !== null))
    return before === null || after === null ? null : after - before
  }

  const gapsIn = (window: typeof scored) =>
    mean(window.filter((p) => p.delivery !== null).map((p) => p.delivery! - p.content))

  return {
    points: scored,
    contentDelta: delta((p) => p.content),
    deliveryDelta: delta((p) => p.delivery),
    enough: scored.length >= MIN_FOR_TREND,
    // The same two windows the deltas use, so every number on the panel is
    // describing the same two periods.
    gap: gapsIn(last),
    gapWas: gapsIn(first),
  }
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
