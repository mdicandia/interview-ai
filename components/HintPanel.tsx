'use client'

import { useCallback, useState } from 'react'
import type { Language } from '@/lib/problems/types'

/**
 * The "I'm stuck" button.
 *
 * Hints are counted and shown, never hidden. In a real interview asking for help
 * is a signal the interviewer weighs, so the count is part of the practice —
 * three hints on an easy problem is information about how the session went, and
 * the report should be able to say so.
 *
 * Previous hints stay on screen rather than being replaced. Re-reading rung one
 * after rung two arrives is usually when it clicks.
 */

export interface Hint {
  text: string
  level: number
  remaining: number
  exhausted: boolean
}

export interface HintPanelProps {
  problemSlug: string
  language: Language
  /** Current editor contents, so the hint can point at their actual code. */
  files: { path: string; content: string }[]
  /** Lets a live interviewer know a hint was taken, so it doesn't repeat it. */
  onHint?: (hint: Hint) => void
}

export function HintPanel({ problemSlug, language, files, onHint }: HintPanelProps) {
  const [hints, setHints] = useState<Hint[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const exhausted = hints[hints.length - 1]?.exhausted ?? false

  const request = useCallback(async () => {
    if (loading || exhausted) return
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problemSlug, language, files, used: hints.length }),
      })
      const payload = (await response.json()) as Hint & { error?: string }
      if (!response.ok || payload.error) {
        setError(payload.error ?? 'Could not get a hint.')
        return
      }
      setHints((current) => [...current, payload])
      onHint?.(payload)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [exhausted, files, hints.length, language, loading, onHint, problemSlug])

  return (
    <section className="flex h-full min-h-0 flex-col border-l border-surface-3 bg-surface-1">
      <header className="flex shrink-0 items-center gap-2 border-b border-surface-3 px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">Hints</h2>
        {hints.length > 0 && (
          <span className="text-[11px] text-ink-2">
            {hints.length} used
            {!exhausted && hints[hints.length - 1] ? `, ${hints[hints.length - 1].remaining} left` : ''}
          </span>
        )}
        <button
          type="button"
          onClick={request}
          disabled={loading || exhausted}
          className="ml-auto rounded border border-surface-3 px-2 py-0.5 text-[11px] text-ink-1 transition-colors hover:border-accent-dim hover:text-ink-0 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? 'Thinking…' : exhausted ? 'No more' : hints.length === 0 ? "I'm stuck" : 'Another'}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        {error && <p className="mb-2 text-[11.5px] leading-relaxed text-fail">{error}</p>}

        {hints.length === 0 && !error && (
          <p className="text-[12px] leading-relaxed text-ink-2">
            Stuck? This gives you one nudge at a time — vaguest first, and never the
            answer. Hints are counted, the same way a real interviewer would remember.
          </p>
        )}

        <ul className="flex flex-col gap-2.5">
          {hints.map((hint, i) => (
            <li key={i}>
              <div className="text-[10px] uppercase tracking-wide text-ink-2">
                {hint.exhausted ? 'Out of hints' : `Hint ${hint.level}`}
              </div>
              {/*
                `break-words` matters here: hints quote real identifiers, and a
                name like `test_raises_the_last_error_when_every_attempt_fails`
                is one unbroken token that overflows the panel without it.
              */}
              <p className="break-words text-[12.5px] leading-relaxed text-ink-0">{hint.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
