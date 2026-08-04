'use client'

import { useState } from 'react'
import { formatValue } from '@/lib/runtime/compare'
import type { RunSummary, TestResult, TestStatus } from '@/lib/runtime/protocol'

const STATUS_STYLES: Record<TestStatus, { dot: string; label: string; text: string }> = {
  pass: { dot: 'bg-pass', label: 'pass', text: 'text-pass' },
  fail: { dot: 'bg-fail', label: 'fail', text: 'text-fail' },
  error: { dot: 'bg-fail', label: 'error', text: 'text-fail' },
  timeout: { dot: 'bg-warn', label: 'timeout', text: 'text-warn' },
  skipped: { dot: 'bg-ink-2', label: 'skipped', text: 'text-ink-2' },
}

function TestRow({ result }: { result: TestResult }) {
  // Failures open by default — that's what you actually want to look at.
  const [open, setOpen] = useState(result.status !== 'pass')
  const style = STATUS_STYLES[result.status]
  const hasDetail = result.status !== 'pass' || result.stdout

  return (
    <li className="border-b border-surface-3 last:border-b-0">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${
          hasDetail ? 'cursor-pointer hover:bg-surface-2' : 'cursor-default'
        }`}
      >
        <span className={`size-1.5 shrink-0 rounded-full ${style.dot}`} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink-0">{result.name}</span>
        {result.hidden && (
          <span className="rounded border border-surface-3 px-1.5 py-px text-[10px] uppercase tracking-wide text-ink-2">
            hidden
          </span>
        )}
        <span className={`shrink-0 text-[11px] tabular-nums ${style.text}`}>{style.label}</span>
        <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-ink-2">
          {result.durationMs >= 1 ? `${Math.round(result.durationMs)}ms` : '<1ms'}
        </span>
      </button>

      {open && hasDetail && (
        <div className="space-y-2 bg-surface-0 px-3 pb-3 pt-1 font-mono text-[11.5px] leading-relaxed">
          {/*
            Only algorithm runs carry args/expected. In a workspace run the
            assertion lives in the candidate's own test file, so the detail
            arrives as `error` text below — the same thing pytest would print.
          */}
          {result.status === 'fail' && result.args && (
            <>
              <Detail label="input" value={result.args.map(formatValue).join(', ')} />
              <Detail label="expected" value={formatValue(result.expected)} tone="pass" />
              <Detail label="actual" value={formatValue(result.actual)} tone="fail" />
            </>
          )}
          {result.error && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-2">error</div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words text-fail">
                {result.error}
              </pre>
            </div>
          )}
          {result.stdout && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-2">output</div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words text-ink-1">
                {result.stdout.trimEnd()}
              </pre>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function Detail({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'pass' | 'fail'
}) {
  const color = tone === 'pass' ? 'text-pass' : tone === 'fail' ? 'text-fail' : 'text-ink-1'
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-ink-2">{label}</span>
      <span className={`min-w-0 flex-1 break-all ${color}`}>{value}</span>
    </div>
  )
}

interface TestPanelProps {
  summary: RunSummary | null
  streaming: TestResult[]
  running: boolean
  bootMessage: string | null
}

export function TestPanel({ summary, streaming, running, bootMessage }: TestPanelProps) {
  // While a run is in flight we show results as they stream in; once it settles we
  // show the finished summary, which also includes skipped/timed-out entries.
  const results = summary ? summary.results : streaming

  return (
    <section className="flex h-full min-h-0 flex-col border-t border-surface-3 bg-surface-1">
      <header className="flex items-center gap-3 border-b border-surface-3 px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">Tests</h2>
        {summary && !summary.compileError && (
          <span
            className={`text-[11px] tabular-nums ${
              summary.passed === summary.total ? 'text-pass' : 'text-ink-1'
            }`}
          >
            {summary.passed}/{summary.total} passing
          </span>
        )}
        {running && <span className="text-[11px] text-ink-2">running…</span>}
        <span className="ml-auto text-[11px] text-ink-2">
          {summary && !running && `${Math.round(summary.totalDurationMs)}ms`}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {bootMessage && (
          <p className="px-3 py-3 text-[12px] text-ink-2">{bootMessage}</p>
        )}

        {summary?.compileError && (
          <div className="px-3 py-3">
            <div className="mb-1.5 text-[10px] uppercase tracking-wide text-fail">
              your code didn&apos;t run
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-fail">
              {summary.compileError}
            </pre>
          </div>
        )}

        {!bootMessage && !summary?.compileError && results.length === 0 && !running && (
          <p className="px-3 py-3 text-[12px] text-ink-2">
            Press <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd> or hit Run to execute the test cases.
          </p>
        )}

        {results.length > 0 && (
          <ul>
            {results.map((result, i) => (
              <TestRow key={`${result.name}-${i}`} result={result} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-0.5 rounded border border-surface-3 bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-1">
      {children}
    </kbd>
  )
}
