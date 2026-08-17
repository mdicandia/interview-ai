'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { DIFFICULTY_COLOR } from '@/lib/problems/types'
import { DrillClient } from '@/lib/client/drill'
import { recordDrill } from '@/lib/session/history'
import type { ClientRapidFireSet } from '@/questions/canon'
import type { DrillResult } from '@/server/interview/drill-grader'

/**
 * A rapid-fire drill: the question, a countdown, and nothing else.
 *
 * The emptiness is the design. There is no editor, no transcript panel, no hint
 * button, no notes — the thing being rehearsed is answering out loud with
 * nothing to look at, which is what the screen that caused two of the rejections
 * behind this project was actually like. Anything else on the page becomes
 * somewhere to look instead of somewhere to think.
 *
 * The one exception is the live transcript under the question, which is there
 * for a specific second-language reason: it shows what the microphone actually
 * heard. Finding out afterwards that a whole answer was transcribed as noise is
 * a much worse experience than seeing it as it happens and slowing down.
 */

const VOICE_URL = process.env.NEXT_PUBLIC_VOICE_SERVER_URL ?? 'ws://localhost:8787'

export function DrillRoom({ set }: { set: ClientRapidFireSet }) {
  const client = useMemo(() => new DrillClient(), [])
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot)

  useEffect(() => () => void client.disconnect(), [client])

  const start = useCallback(() => {
    void client.connect({ url: VOICE_URL, setSlug: set.slug })
  }, [client, set.slug])

  /*
   * The history row is written here rather than inside the client.
   *
   * The client owns the socket and the marking; localStorage is not its
   * business, and coupling it to the history store would make a socket class
   * impossible to reason about offline. Ref-guarded rather than state-guarded
   * because writing a row is not a render input — nothing on screen changes
   * because it happened.
   */
  const recorded = useRef<DrillResult | null>(null)
  useEffect(() => {
    const result = snapshot.result
    if (!result || recorded.current === result) return
    recorded.current = result
    recordDrill({
      slug: set.slug,
      title: set.title,
      covered: result.covered,
      total: result.total,
      answered: result.questions.filter((q) => q.answer.trim() !== '').length,
      elapsedMs: client.elapsedMs(),
    })
  }, [snapshot.result, set.slug, set.title, client])

  if (snapshot.marking !== 'idle') {
    return <Summary set={set} snapshot={snapshot} onRetry={start} />
  }

  if (snapshot.status === 'idle' || snapshot.status === 'error') {
    return <Intro set={set} error={snapshot.error} onStart={start} />
  }

  return <Running set={set} client={client} snapshot={snapshot} />
}

/* ---------------------------------------------------------------------- intro */

function Intro({
  set,
  error,
  onStart,
}: {
  set: ClientRapidFireSet
  error: string | null
  onStart: () => void
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-0 px-6">
      <div className="w-full max-w-[52ch]">
        <Link href="/" className="text-[13px] text-ink-2 transition-colors hover:text-ink-0">
          ← Back
        </Link>

        <h1 className="mt-6 text-[22px] font-medium text-ink-0">{set.title}</h1>
        <p className="mt-1.5 text-[13px] text-ink-2">{set.blurb}</p>

        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-2">
          <span className={DIFFICULTY_COLOR[set.difficulty]}>{set.difficulty}</span>
          <span>{set.questions.length} questions</span>
          <span>{set.seconds} seconds each</span>
          <span>
            about {Math.round((set.questions.length * (set.seconds + 8)) / 60)} minutes
          </span>
        </div>

        <div className="mt-7 rounded-lg border border-surface-3 bg-surface-1 px-4 py-3.5 text-[12.5px] leading-relaxed text-ink-1">
          <p>
            Each question is asked out loud, then you have {set.seconds} seconds. There are no
            follow-ups and no hints — say what you know and move on. Press{' '}
            <kbd className="rounded border border-surface-3 bg-surface-2 px-1 font-mono text-[11px]">
              space
            </kbd>{' '}
            when you have finished an answer rather than waiting out the clock.
          </p>
          <p className="mt-2.5 text-ink-2">
            Everything is marked at the end, in one pass. You will not be told how you did
            until then, deliberately — knowing you missed question three is exactly what
            wrecks question four.
          </p>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-[12.5px] text-fail">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={onStart}
          className="mt-6 rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-surface-0 transition-opacity hover:opacity-90"
        >
          Start the drill
        </button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- running */

function Running({
  set,
  client,
  snapshot,
}: {
  set: ClientRapidFireSet
  client: DrillClient
  snapshot: ReturnType<DrillClient['getSnapshot']>
}) {
  const { index, remaining, seconds, heard, interim } = snapshot
  const question = set.questions[index]

  const next = useCallback(() => client.next(), [client])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.code !== 'Enter') return
      event.preventDefault()
      next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next])

  const fraction = remaining === null ? 1 : remaining / seconds
  const listening = remaining !== null

  return (
    <div className="flex min-h-screen flex-col bg-surface-0">
      <header className="flex shrink-0 items-center gap-4 border-b border-surface-3 bg-surface-1 px-4 py-2.5">
        <span className="text-[13px] font-medium text-ink-0">{set.title}</span>
        <span className="text-[11.5px] tabular-nums text-ink-2">
          {Math.max(1, index + 1)} of {set.questions.length}
        </span>
        <span className="ml-auto text-[11.5px] text-ink-2">
          {listening ? 'Answer now' : 'Listen'}
        </span>
      </header>

      {/* Progress across the whole set, so you know how much is left without counting. */}
      <div className="flex shrink-0 gap-1 px-4 py-2">
        {set.questions.map((q, i) => (
          <span
            key={q.id}
            className={`h-1 flex-1 rounded-full ${
              i < index ? 'bg-accent' : i === index ? 'bg-accent/50' : 'bg-surface-3'
            }`}
          />
        ))}
      </div>

      <main className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-16">
        <div className="w-full max-w-[60ch]">
          <p className="mb-4 text-[10.5px] uppercase tracking-wider text-ink-2">
            {question?.topic}
          </p>

          <h1
            // Announced rather than silently swapped: the question changes with
            // no interaction, which a screen reader would otherwise never
            // mention, and the audio is not a substitute for anyone using one.
            aria-live="polite"
            className="text-[22px] font-medium leading-snug text-ink-0"
          >
            {question?.prompt}
          </h1>

          <div className="mt-8" aria-live="off">
            {listening ? (
              <div className="flex items-center gap-4">
                <span
                  className={`font-mono text-[34px] tabular-nums ${
                    remaining !== null && remaining <= 10 ? 'text-warn' : 'text-ink-1'
                  }`}
                >
                  {remaining}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <span
                    className={`block h-full rounded-full transition-[width] duration-200 ease-linear ${
                      fraction < 0.2 ? 'bg-warn' : 'bg-accent'
                    }`}
                    style={{ width: `${Math.round(fraction * 100)}%` }}
                  />
                </span>
              </div>
            ) : (
              <p className="text-[13px] text-ink-2">Reading the question…</p>
            )}
          </div>

          {/*
            What the microphone heard, not a transcript to read back. Fixed
            height so the question does not jump up the page as it fills.
          */}
          <p className="mt-6 h-[4.5rem] overflow-hidden text-[13px] leading-relaxed text-ink-2">
            {heard}
            {interim && <span className="text-ink-2/50"> {interim}</span>}
          </p>

          <button
            type="button"
            onClick={next}
            disabled={!listening}
            className="mt-2 rounded-md border border-surface-3 px-3.5 py-1.5 text-[12.5px] text-ink-2 transition-colors hover:border-accent-dim hover:text-accent disabled:opacity-40 disabled:hover:border-surface-3 disabled:hover:text-ink-2"
          >
            Done — next question{' '}
            <kbd className="ml-1 font-mono text-[10.5px] text-ink-2">space</kbd>
          </button>
        </div>
      </main>
    </div>
  )
}

/* -------------------------------------------------------------------- summary */

function Summary({
  set,
  snapshot,
  onRetry,
}: {
  set: ClientRapidFireSet
  snapshot: ReturnType<DrillClient['getSnapshot']>
  onRetry: () => void
}) {
  return (
    <div className="min-h-screen bg-surface-0 px-6 py-10">
      <div className="mx-auto w-full max-w-[70ch]">
        <Link href="/" className="text-[13px] text-ink-2 transition-colors hover:text-ink-0">
          ← Back
        </Link>
        <h1 className="mt-5 text-[20px] font-medium text-ink-0">{set.title}</h1>

        {snapshot.marking === 'marking' && (
          <p className="mt-6 text-[13px] text-ink-2" role="status">
            Marking all {set.questions.length} answers…
          </p>
        )}

        {snapshot.marking === 'failed' && (
          <div className="mt-6">
            <p role="alert" className="text-[13px] text-fail">
              {snapshot.error}
            </p>
            <p className="mt-2 text-[12.5px] text-ink-2">
              The answers are gone — they were only ever held in the page. Running the drill
              again is the only way back, which is the cost of not persisting a round nobody
              asked to keep.
            </p>
          </div>
        )}

        {snapshot.result && <Marked result={snapshot.result} />}

        <button
          type="button"
          onClick={onRetry}
          className="mt-8 rounded-md border border-surface-3 px-3.5 py-1.5 text-[12.5px] text-ink-2 transition-colors hover:border-accent-dim hover:text-accent"
        >
          Run it again
        </button>
      </div>
    </div>
  )
}

function Marked({ result }: { result: DrillResult }) {
  return (
    <>
      <p className="mt-2 text-[13px] text-ink-1">
        <span className="tabular-nums text-ink-0">
          {result.covered} of {result.total}
        </span>{' '}
        points covered.
      </p>

      {/*
        The weak topics come first, above the per-question detail, because they
        are the only part that says what to do next. A score tells you how the
        morning went; a topic tells you what to read this afternoon.
      */}
      {result.weakTopics.length > 0 ? (
        <div className="mt-6 rounded-lg border border-warn/40 bg-warn/5 px-4 py-3.5">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-warn">
            Weakest topics
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
            {result.weakTopics.map((topic) => (
              <li key={topic.topic} className="text-[13px] text-ink-1">
                {topic.topic}{' '}
                <span className="tabular-nums text-ink-2">
                  {topic.covered}/{topic.total}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-6 text-[13px] text-pass">
          No topic came out under half. Nothing here needs re-reading before the next screen.
        </p>
      )}

      <ul className="mt-8 flex flex-col gap-5">
        {result.questions.map((question, i) => {
          const missed = question.points.filter((_, j) => !question.covered.includes(j + 1))
          return (
            <li key={question.id} className="border-t border-surface-3 pt-4">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[11px] text-ink-2">#{i + 1}</span>
                <p className="flex-1 text-[13.5px] text-ink-0">{question.prompt}</p>
                <span
                  className={`shrink-0 tabular-nums text-[12px] ${
                    question.covered.length === question.points.length
                      ? 'text-pass'
                      : question.covered.length === 0
                        ? 'text-fail'
                        : 'text-warn'
                  }`}
                >
                  {question.covered.length}/{question.points.length}
                </span>
              </div>

              {question.answer === '' ? (
                <p className="mt-2 pl-8 text-[12.5px] text-ink-2">You said nothing.</p>
              ) : (
                <p className="mt-2 pl-8 text-[12.5px] leading-relaxed text-ink-2">
                  {question.answer}
                </p>
              )}

              {missed.length > 0 && (
                <div className="mt-2.5 pl-8">
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-2">
                    Missed
                  </div>
                  <ul className="flex flex-col gap-1">
                    {missed.map((point) => (
                      <li key={point} className="text-[12.5px] leading-relaxed text-ink-1">
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}
