'use client'

import { useCallback, useState } from 'react'
import type { Language } from '@/lib/problems/types'
import type { SolutionResponse } from '@/app/api/solution/route'
import { Editor } from './Editor'

/**
 * "Show me the solution", behind one confirmation.
 *
 * Deliberately not a plain button. Revealing the answer ends the round in the
 * only way that matters, and a single misclick should not be able to do that
 * while you are mid-thought. Equally it is deliberately *reachable* — being
 * stuck with the hint ladder spent and no way to see how it should have gone is
 * how a practice session ends in nothing.
 *
 * The hint ladder is shown alongside as reading notes: it is the sequence of
 * realisations the problem is about, so the code lands as an explanation rather
 * than something to copy.
 */
export function SolutionPanel({
  problemSlug,
  language,
  onRevealed,
}: {
  problemSlug: string
  language: Language
  /** Told to the report, so a revealed solution is weighed honestly. */
  onRevealed?: () => void
}) {
  const [solution, setSolution] = useState<SolutionResponse | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activePath, setActivePath] = useState<string | null>(null)

  const reveal = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/solution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problemSlug, language }),
      })
      const payload = (await response.json()) as SolutionResponse & { error?: string }
      if (!response.ok || payload.error) {
        setError(payload.error ?? 'Could not load the solution.')
        return
      }
      setSolution(payload)
      setActivePath(payload.files[0]?.path ?? null)
      onRevealed?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
      setConfirming(false)
    }
  }, [language, onRevealed, problemSlug])

  if (!solution) {
    return (
      <section className="flex h-full min-h-0 flex-col items-start gap-3 border-l border-surface-3 bg-surface-1 px-4 py-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">Solution</h2>

        {error && <p className="text-[11.5px] leading-relaxed text-fail">{error}</p>}

        {confirming ? (
          <>
            <p className="text-[12.5px] leading-relaxed text-ink-0">
              This ends the exercise. You&apos;ll learn more from one more attempt with a
              hint than from reading this — but if you&apos;re done, it&apos;s better than
              walking away with nothing.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={reveal}
                disabled={loading}
                className="rounded bg-warn px-3 py-1 text-[12px] font-medium text-surface-0 transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {loading ? 'Loading…' : 'Show it'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded border border-surface-3 px-3 py-1 text-[12px] text-ink-2 transition-colors hover:text-ink-0"
              >
                Keep trying
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[12.5px] leading-relaxed text-ink-2">
              Stuck for good? You can read the reference solution, with notes on what to
              look for in it.
            </p>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded border border-surface-3 px-3 py-1 text-[12px] text-ink-1 transition-colors hover:border-warn/60 hover:text-ink-0"
            >
              Show me the solution
            </button>
          </>
        )}
      </section>
    )
  }

  const active = solution.files.find((f) => f.path === activePath) ?? solution.files[0]

  return (
    <section className="flex h-full min-h-0 flex-col border-l border-surface-3 bg-surface-1">
      <header className="shrink-0 border-b border-surface-3 px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
          Reference solution
        </h2>
      </header>

      {solution.notes.length > 0 && (
        <div className="shrink-0 border-b border-surface-3 px-3 py-2.5">
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-accent">
            What to look for
          </div>
          <ol className="flex list-inside list-decimal flex-col gap-1">
            {solution.notes.map((note, i) => (
              <li key={i} className="text-[12px] leading-relaxed text-ink-1">
                {note}
              </li>
            ))}
          </ol>
        </div>
      )}

      {solution.files.length > 1 && (
        <div className="flex shrink-0 overflow-x-auto border-b border-surface-3">
          {solution.files.map((file) => (
            <button
              key={file.path}
              type="button"
              onClick={() => setActivePath(file.path)}
              className={`whitespace-nowrap border-r border-surface-3 px-3 py-1.5 font-mono text-[11.5px] transition-colors ${
                file.path === active.path ? 'bg-surface-0 text-ink-0' : 'text-ink-2 hover:text-ink-1'
              }`}
            >
              {file.path}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        <Editor
          key={active.path}
          value={active.content}
          language={language}
          readOnly
          onChange={() => {}}
        />
      </div>
    </section>
  )
}
