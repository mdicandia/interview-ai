'use client'

import { useEffect, useState } from 'react'
import type { Language } from '@/lib/problems/types'

/**
 * Everything that happened during a session, accumulated as it happens.
 *
 * **This lives in the browser, not the voice server, and that is deliberate.**
 *
 * The obvious place to build a report is `InterviewSession` — it already holds the
 * transcript and the conversation history. But it holds *only* those. The code,
 * the test runs, the hints, and the per-round timings all live on this side, and
 * more importantly the voice server may never have been connected at all: a round
 * worked through in silence, with no microphone, is a completely normal way to
 * practise. A server-built report would produce nothing for it.
 *
 * The browser sees every signal, including the transcript, so the record is
 * assembled here and posted to `/api/report` at the end. The route re-loads the
 * problems server-side, which is where the answer keys — reference solutions,
 * reference patches, expected points — finally get used: they are what let the
 * report judge the code rather than just describe it, and they still never reach
 * the client.
 *
 * Timings are read from the session store rather than recomputed, so a paused
 * clock stays paused here too.
 */

const STORAGE_KEY = 'interview-ai:record:v1'

export interface RunRecord {
  at: number
  passed: number
  total: number
  failing: string[]
  compileError?: string
}

export interface TranscriptLine {
  role: 'candidate' | 'interviewer'
  text: string
  at: number
}

export interface HintRecord {
  level: number
  text: string
  at: number
}

export interface RoundRecord {
  slug: string
  title: string
  source: 'problem' | 'question'
  /** The stage label from the template ("Debugging", "Discussion"), if any. */
  label: string
  language: Language | null
  /** Wall-clock ms this round was first opened. */
  enteredAt: number
  /** Suggested length in ms; 0 when the round was opened outside a session. */
  allottedMs: number
  /** Filled in when the session is sealed, from the session store's clock. */
  elapsedMs: number
  transcript: TranscriptLine[]
  hints: HintRecord[]
  runs: RunRecord[]
  /** Editor contents as they stood last time anything was recorded. */
  files: { path: string; content: string }[]
}

export interface SessionRecord {
  id: string
  name: string
  startedAt: number
  /** Set when the candidate ends the session. Null while it is still running. */
  endedAt: number | null
  /** Rounds in the order they were first opened. */
  rounds: RoundRecord[]
}

/* -------------------------------------------------------------------- storage */

export function readRecord(): SessionRecord | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SessionRecord
    return Array.isArray(parsed?.rounds) ? parsed : null
  } catch {
    return null
  }
}

function write(record: SessionRecord | null): void {
  if (typeof window === 'undefined') return
  try {
    if (record) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // A full quota shouldn't take the interview down. The in-memory UI carries on;
    // only the report is lost, and it says so rather than inventing one.
  }
  window.dispatchEvent(new Event('interview-ai:record-changed'))
}

/**
 * Applies a change to one round, creating the round and the record if needed.
 *
 * Read-modify-write on every event rather than an in-memory cache: the rooms
 * unmount and remount as you move between stages, so there is no single object
 * alive for the whole session to hold the state in.
 */
function mutate(
  meta: Pick<RoundRecord, 'slug' | 'title' | 'source' | 'label' | 'language' | 'allottedMs'>,
  change: (round: RoundRecord) => void,
): void {
  const record: SessionRecord = readRecord() ?? {
    id: `session-${Date.now()}`,
    name: 'Practice',
    startedAt: Date.now(),
    endedAt: null,
    rounds: [],
  }

  // A sealed record belongs to a finished session; anything arriving after it
  // starts a new one rather than reopening the report that was just generated.
  if (record.endedAt !== null) {
    beginRecord(record.name)
    mutate(meta, change) // recurses exactly once; the new record is not sealed
    return
  }

  let round = record.rounds.find((r) => r.slug === meta.slug)
  if (!round) {
    round = {
      ...meta,
      enteredAt: Date.now(),
      elapsedMs: 0,
      transcript: [],
      hints: [],
      runs: [],
      files: [],
    }
    record.rounds.push(round)
  } else {
    // Language can change mid-round, and a directly-opened problem picks up its
    // label and allotment only once a session takes it over.
    round.language = meta.language
    if (meta.label) round.label = meta.label
    if (meta.allottedMs) round.allottedMs = meta.allottedMs
  }

  change(round)
  write(record)
}

/* ---------------------------------------------------------------- public API */

/** Starts a fresh record. Called when a session starts, discarding the last one. */
export function beginRecord(name: string): void {
  write({
    id: `session-${Date.now()}`,
    name,
    startedAt: Date.now(),
    endedAt: null,
    rounds: [],
  })
}

export type RoundMeta = Pick<
  RoundRecord,
  'slug' | 'title' | 'source' | 'label' | 'language' | 'allottedMs'
>

/** Registers the round so it appears in the report even if nothing happens in it. */
export function enterRound(meta: RoundMeta): void {
  mutate(meta, () => {})
}

/**
 * Replaces the round's transcript wholesale.
 *
 * The voice client already owns the authoritative list — including the in-place
 * replacement of interim lines by final ones — so mirroring it is both simpler
 * and less wrong than appending line by line from here.
 */
export function recordTranscript(meta: RoundMeta, lines: TranscriptLine[]): void {
  mutate(meta, (round) => {
    round.transcript = lines
  })
}

export function recordHint(meta: RoundMeta, hint: HintRecord): void {
  mutate(meta, (round) => {
    round.hints.push(hint)
  })
}

export function recordRun(meta: RoundMeta, run: RunRecord): void {
  mutate(meta, (round) => {
    round.runs.push(run)
  })
}

export function recordFiles(meta: RoundMeta, files: { path: string; content: string }[]): void {
  mutate(meta, (round) => {
    round.files = files
  })
}

/**
 * Closes the record and stamps the real per-round timings onto it.
 *
 * Called from the session bar before the session state is cleared — the clock is
 * the one thing the record cannot reconstruct for itself, because pauses and
 * revisits are only tracked in the session store.
 */
export function sealRecord(elapsedBySlug: Record<string, number>): SessionRecord | null {
  const record = readRecord()
  if (!record) return null
  for (const round of record.rounds) {
    round.elapsedMs = elapsedBySlug[round.slug] ?? Date.now() - round.enteredAt
  }
  record.endedAt = Date.now()
  write(record)
  return record
}

export function clearRecord(): void {
  write(null)
}

/** True when there is something worth generating a report from. */
export function hasEvidence(record: SessionRecord | null): boolean {
  if (!record) return false
  return record.rounds.some(
    (r) => r.transcript.length > 0 || r.runs.length > 0 || r.hints.length > 0 || r.files.length > 0,
  )
}

/**
 * Subscribes to the record.
 *
 * `loaded` distinguishes "not read yet" from "read, and there is nothing" — a
 * distinction the report page needs, since one means show a spinner and the other
 * means say so.
 */
export function useRecord(): { record: SessionRecord | null; loaded: boolean } {
  const [state, setState] = useState<{ record: SessionRecord | null; loaded: boolean }>({
    record: null,
    loaded: false,
  })

  // After mount, not during render: there is no localStorage on the server, and
  // seeding state from it directly would be a hydration mismatch.
  useEffect(() => {
    const sync = () => setState({ record: readRecord(), loaded: true })
    sync()
    window.addEventListener('interview-ai:record-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('interview-ai:record-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return state
}
