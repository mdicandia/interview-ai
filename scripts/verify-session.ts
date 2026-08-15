/**
 * The browser's persistence layer, against a fake localStorage and a fake clock.
 *
 * This half of the app had no tests at all, and it is where every bug the tool
 * has actually shown its user came from: spoken rounds filed as "abandoned"
 * however well they went, durations frozen at `0:00`, a round recharged for the
 * whole session because leaving a later one re-derived it, and forty minutes of
 * work lost to a reload before drafts existed. None of it is reachable from the
 * voice server's suite, because none of it involves the voice server.
 *
 * All of it is pure functions over storage, so the whole file runs offline in
 * milliseconds. Both fakes are deliberate: `Date.now` is stubbed because the
 * rules under test are *about* time — what gets frozen and what gets refreshed —
 * and a real clock can only assert that badly.
 *
 * Run with: pnpm verify:session
 */

import type { RoundRecord, SessionRecord } from '../lib/session/record'
import type { SessionState } from '../lib/session/store'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

let failures = 0
function check(ok: boolean, label: string, detail = '') {
  if (ok) console.log(`  ${GREEN}✓${RESET} ${label}${detail ? ` ${DIM}${detail}${RESET}` : ''}`)
  else {
    failures += 1
    console.log(`  ${RED}✗${RESET} ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/* ------------------------------------------------------------------- the fakes */

class MemoryStorage {
  #data = new Map<string, string>()
  getItem(key: string): string | null {
    return this.#data.has(key) ? this.#data.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.#data.set(key, String(value))
  }
  removeItem(key: string): void {
    this.#data.delete(key)
  }
  clear(): void {
    this.#data.clear()
  }
}

const storage = new MemoryStorage()

// Installed before the modules load. They read `window` inside functions rather
// than at module scope, but the import below is dynamic anyway so the order is
// guaranteed rather than assumed.
globalThis.window = {
  localStorage: storage,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
} as unknown as Window & typeof globalThis

const T0 = Date.parse('2026-08-15T09:00:00Z')
let now = T0
Date.now = () => now
const min = (n: number) => n * 60_000
/** Advances the fake clock. */
const wait = (ms: number) => {
  now += ms
}

/* -------------------------------------------------------------------- builders */

function round(over: Partial<RoundRecord> & { slug: string }): RoundRecord {
  return {
    title: over.slug,
    source: 'problem',
    label: 'Coding',
    language: 'python',
    enteredAt: now,
    allottedMs: min(25),
    elapsedMs: 0,
    transcript: [],
    hints: [],
    runs: [],
    observations: [],
    files: [],
    ...over,
  }
}

function session(id: string, rounds: RoundRecord[], endedAt: number | null = null): SessionRecord {
  return { id, name: 'Practice', startedAt: T0, endedAt, rounds }
}

const run = (passed: number, total: number) => ({ at: now, passed, total, failing: [] })
const line = (text: string) => ({ role: 'candidate' as const, text, at: now })

async function main() {
  const { readRecord, beginRecord, enterRound, recordTranscript, sealRecord, hasEvidence, resumableTranscript, recordConcluded } =
    await import('../lib/session/record')
  const { recordAttempts, readHistory, attachScores, byProblem, clearHistory } =
    await import('../lib/session/history')
  const { readDraft, writeDraft, clearDraft } = await import('../lib/session/drafts')
  const { formatDuration, stageElapsed } = await import('../lib/session/store')

  /** The outcome the history derives for one round, in isolation. */
  const outcomeOf = (over: Partial<RoundRecord> & { slug: string }) => {
    clearHistory()
    const rows = recordAttempts(session(`s-${over.slug}`, [round(over)]))
    return rows[rows.length - 1]
  }

  console.log('\nOutcome of a coding round')
  {
    check(outcomeOf({ slug: 'a' }).outcome === 'abandoned', 'never run at all is abandoned, not failed')
    check(outcomeOf({ slug: 'b', runs: [run(5, 5)] }).outcome === 'solved', 'all green is solved')
    check(outcomeOf({ slug: 'c', runs: [run(2, 5)] }).outcome === 'partial', 'some green is partial')
    check(outcomeOf({ slug: 'd', runs: [run(0, 5)] }).outcome === 'not-solved', 'none green is not-solved')
    // The *last* run, not the best one: a green suite you then broke is not a
    // solve, and recording the high-water mark would flatter every session.
    const regressed = outcomeOf({ slug: 'e', runs: [run(5, 5), run(2, 5)] })
    check(regressed.outcome === 'partial', 'the last run wins, not the best', `${regressed.passed}/${regressed.total}`)
  }

  console.log('\nOutcome of a spoken round')
  {
    // The regression that filed every discussion round as abandoned: a spoken
    // round runs no tests, so a test-count rule had nothing to read.
    const silent = outcomeOf({ slug: 'q1', source: 'question' })
    check(silent.outcome === 'abandoned', 'a question never answered is abandoned')

    const talked = outcomeOf({ slug: 'q2', source: 'question', transcript: [line('well, an index is…')] })
    check(talked.outcome === 'partial', 'talking with nothing tallied still beats abandoning it')

    const covered = outcomeOf({
      slug: 'q3',
      source: 'question',
      objectives: { covered: 4, total: 9, essential: 4 },
      transcript: [line('…')],
    })
    check(covered.outcome === 'solved', 'every essential point reached is solved')
    check(covered.passed === 4 && covered.total === 9, 'coverage fills the same slots as test counts', `${covered.passed}/${covered.total}`)

    const some = outcomeOf({ slug: 'q4', source: 'question', objectives: { covered: 2, total: 9, essential: 4 }, transcript: [line('…')] })
    check(some.outcome === 'partial', 'some of the essentials is partial')

    const none = outcomeOf({ slug: 'q5', source: 'question', objectives: { covered: 0, total: 9, essential: 4 }, transcript: [line('…')] })
    check(none.outcome === 'not-solved', 'none of them is not-solved')

    clearHistory()
    const record = session('s-verdict', [
      round({ slug: 'q6', source: 'question', transcript: [line('…')], concluded: { verdict: 'mixed', summary: 'ok' } }),
    ])
    check(recordAttempts(record)[0].verdict === 'mixed', "carries the interviewer's verdict through")
  }

  console.log('\nWhat a checkpoint freezes')
  {
    clearHistory()
    const record = session('s1', [round({ slug: 'one' }), round({ slug: 'two' })])

    wait(min(10))
    recordAttempts(record, 'one')
    const afterFirst = readHistory().find((a) => a.slug === 'one')!
    check(afterFirst.elapsedMs === min(10), 'the round being left gets its real duration', formatDuration(afterFirst.elapsedMs))

    // The original bug: a checkpoint walks *every* round, so leaving a later one
    // re-derived `now - enteredAt` for the first and charged it for the whole
    // session — a ten-minute round permanently recorded as forty-five.
    wait(min(35))
    recordAttempts(record, 'two')
    const one = readHistory().find((a) => a.slug === 'one')!
    const two = readHistory().find((a) => a.slug === 'two')!
    check(one.elapsedMs === min(10), 'an earlier round keeps its own duration', formatDuration(one.elapsedMs))
    check(two.elapsedMs === min(45), 'while the active one is refreshed', formatDuration(two.elapsedMs))
    check(readHistory().filter((a) => a.slug === 'one').length === 1, 'and nothing is duplicated')
  }

  console.log('\nThe 0:00 rows')
  {
    // StrictMode mounts, unmounts and remounts, so the first checkpoint lands
    // milliseconds after entering. Freezing on first write recorded every round
    // as 0:00 forever.
    clearHistory()
    const record = session('s2', [round({ slug: 'strict' })])
    recordAttempts(record, 'strict')
    check(readHistory()[0].elapsedMs === 0, 'the instant checkpoint writes a zero')

    wait(min(12))
    recordAttempts(record, 'strict')
    check(readHistory()[0].elapsedMs === min(12), 'and a later one corrects it', formatDuration(readHistory()[0].elapsedMs))
  }

  console.log('\nSealing, repeats and scores')
  {
    clearHistory()
    const record = session('s3', [round({ slug: 'seal', runs: [run(3, 3)] })])
    wait(min(30))
    // Sealing carries per-stage timings from the session clock, including pauses,
    // so it overrides the wall-clock estimate rather than deferring to it.
    record.rounds[0].elapsedMs = min(18)
    record.endedAt = now
    recordAttempts(record)
    check(readHistory()[0].elapsedMs === min(18), 'a sealed record uses the session clock, not the wall clock', formatDuration(readHistory()[0].elapsedMs))

    attachScores('s3', [{ slug: 'seal', content: 4, delivery: 2, diagnosisKind: 'expression-lags-knowledge' }])
    recordAttempts(record)
    const scored = readHistory()[0]
    check(scored.content === 4 && scored.delivery === 2, 'report scores survive a later checkpoint', `content ${scored.content}, delivery ${scored.delivery}`)

    // A second go at the same problem is a new row, in a new session. Collapsing
    // to a personal best would throw away the shape of the improvement, which is
    // the only thing the history page exists to show.
    wait(min(60))
    recordAttempts(session('s4', [round({ slug: 'seal', runs: [run(3, 3)], elapsedMs: min(11) })], now))
    const rows = readHistory().filter((a) => a.slug === 'seal')
    check(rows.length === 2, 'a repeat is a new row, not an update', `${rows.length} rows`)

    const [progress] = byProblem(readHistory())
    check(progress.timeDeltaMs === min(11) - min(18), 'and the delta compares latest against first', formatDuration(progress.timeDeltaMs ?? 0))
    check(progress.attempts[0].elapsedMs === min(18), 'oldest first')
  }

  console.log('\nThe evidence record')
  {
    storage.clear()
    check(readRecord() === null, 'nothing stored reads as nothing')
    check(!hasEvidence(readRecord()), 'and is not worth a report')

    const meta = { slug: 'r1', title: 'R1', source: 'question' as const, label: 'Discussion', language: null, allottedMs: min(12) }
    enterRound(meta)
    check(readRecord()?.rounds.length === 1, 'entering a round registers it')
    check(!hasEvidence(readRecord()), 'an empty round is still not evidence')

    recordTranscript(meta, [{ role: 'candidate', text: 'an index is a B-tree', at: now }])
    check(hasEvidence(readRecord()), 'a transcript is')

    // A sealed record belongs to a finished session. Anything arriving after it
    // must start a new one rather than reopening the report just generated —
    // this path recursed infinitely on the first attempt at it.
    const before = readRecord()!.id
    sealRecord({ r1: min(12) })
    // A record is identified by the millisecond it began, so the clock has to
    // move for the new one to be distinguishable. Real sessions are a click
    // apart; a frozen clock is the only way to collide.
    wait(1)
    enterRound({ ...meta, slug: 'r2', title: 'R2' })
    const after = readRecord()!
    check(after.id !== before, 'writing to a sealed record starts a new one', after.id)
    check(after.endedAt === null && after.rounds.length === 1, 'and the new one is open and empty of the old round')
  }

  console.log('\nWhat may be resumed')
  {
    storage.clear()
    beginRecord('Practice')
    const meta = { slug: 'r3', title: 'R3', source: 'question' as const, label: 'Discussion', language: null, allottedMs: min(12) }
    enterRound(meta)
    check(resumableTranscript('r3').length === 0, 'a round with nothing said resumes nothing')

    recordTranscript(meta, [{ role: 'candidate', text: 'so, the tree', at: now }])
    check(resumableTranscript('r3').length === 1, 'an open round hands back what was said')
    check(resumableTranscript('nope').length === 0, 'an unknown slug does not')

    // Pressing Start on a finished round means "again", not "carry on". Replaying
    // the last conversation into a fresh attempt would poison it.
    recordConcluded(meta, { verdict: 'solid', summary: 'good' })
    check(resumableTranscript('r3').length === 0, 'a concluded round starts fresh')

    storage.clear()
    beginRecord('Practice')
    enterRound(meta)
    recordTranscript(meta, [{ role: 'candidate', text: 'so, the tree', at: now }])
    sealRecord({ r3: min(12) })
    check(resumableTranscript('r3').length === 0, 'and so does a round in a sealed session')
  }

  console.log('\nDrafts')
  {
    storage.clear()
    check(readDraft('two-sum', 'python') === null, 'no draft reads as null, not as an empty file')

    writeDraft('two-sum', 'python', { 'solution.py': 'def f(): pass' })
    writeDraft('two-sum', 'typescript', { 'solution.ts': 'export {}' })
    check(readDraft('two-sum', 'python')?.['solution.py'] === 'def f(): pass', 'a draft round-trips')
    check(readDraft('two-sum', 'typescript') !== null, 'languages are stored side by side')

    clearDraft('two-sum', 'python')
    check(readDraft('two-sum', 'python') === null, 'Reset really does forget it')
    check(readDraft('two-sum', 'typescript') !== null, 'and leaves the other language alone')

    writeDraft('two-sum', 'python', {})
    check(readDraft('two-sum', 'python') === null, 'an empty set of files is not a draft')
  }

  console.log('\nThe clock')
  {
    check(formatDuration(0) === '0:00', 'zero')
    check(formatDuration(61_000) === '1:01', 'pads the seconds')
    check(formatDuration(59_999) === '0:59', 'rounds down, so it never shows a minute early')
    // Nothing here ever ends a round, so overtime is a number to show, not a
    // limit to enforce.
    check(formatDuration(-5_000) === '-0:05', 'counts into overtime rather than clamping')

    const state: SessionState = {
      templateId: 't', name: 'n', stages: [], currentIndex: 1,
      elapsedMs: [min(10), min(4)], runningSince: now - min(2), startedAt: T0,
    }
    check(stageElapsed(state, 1) === min(6), 'the running stage adds the interval in progress', formatDuration(stageElapsed(state, 1)))
    check(stageElapsed(state, 0) === min(10), 'a stage you left does not keep counting')
    check(stageElapsed({ ...state, runningSince: null }, 1) === min(4), 'and a paused clock stands still')
  }

  console.log(
    failures === 0
      ? `\n${GREEN}All session-storage checks passed.${RESET}\n`
      : `\n${RED}${failures} check(s) failed.${RESET}\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

void main()
