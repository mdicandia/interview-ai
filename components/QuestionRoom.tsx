'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { ClientQuestion } from '@/questions'
import { DISCUSSION_FORMAT_LABELS } from '@/lib/problems/types'
import type { Observation, TranscriptLine } from '@/lib/client/voice'
import { useSession } from '@/lib/session/store'
import {
  checkpointRound,
  enterRound,
  recordObservations,
  recordTranscript,
} from '@/lib/session/record'
import { Editor } from './Editor'
import { VoicePanel } from './VoicePanel'
import { SessionBar } from './SessionBar'

/**
 * A spoken round: the interviewer asks, you answer out loud, it follows up.
 *
 * Still no answer box and no rubric reveal, and that stays deliberate. A
 * self-marked checklist is a different exercise from being questioned — the
 * value here is having to say it to someone who will push on the parts you
 * skipped, which is the part that is hard about the real thing.
 *
 * The expected points and probes never reach the browser; `toClientQuestion`
 * strips them, and the interviewer receives them server-side. That is what lets
 * it tell "hasn't said it yet" from "doesn't know it" without ever putting the
 * answer key somewhere the candidate could read it.
 */
/**
 * Hoisted so its identity is stable.
 *
 * Passed inline, a fresh `[]` on every render re-triggers VoicePanel's debounced
 * `sendCode` effect, clearing and rescheduling the timer forever — during an
 * active conversation the transcript re-renders often enough that it would never
 * fire at all.
 */
const NO_FILES: { path: string; content: string }[] = []

export function QuestionRoom({ question }: { question: ClientQuestion }) {
  const files = question.context ?? []
  const [activePath, setActivePath] = useState(files[0]?.path ?? '')
  const activeFile = files.find((f) => f.path === activePath) ?? files[0]

  const { session } = useSession()
  const stage = session?.stages.find((s) => s.slug === question.slug)
  const meta = useMemo(
    () => ({
      slug: question.slug,
      title: question.title,
      source: 'question' as const,
      label: stage?.label ?? 'Discussion',
      language: null,
      allottedMs: (stage?.minutes ?? question.expectedMinutes) * 60_000,
    }),
    [question.slug, question.title, question.expectedMinutes, stage?.label, stage?.minutes],
  )

  useEffect(() => {
    enterRound(meta)
  }, [meta])

  // Same as a coding round: the attempt is written on the way out, so a spoken
  // round counts even if the session is never formally ended.
  useEffect(() => {
    const capture = () => checkpointRound()
    window.addEventListener('pagehide', capture)
    return () => {
      window.removeEventListener('pagehide', capture)
      capture()
    }
  }, [])

  const onTranscript = useCallback(
    (lines: TranscriptLine[]) =>
      recordTranscript(
        meta,
        lines.map(({ role, text, at }) => ({ role, text, at })),
      ),
    [meta],
  )

  const onObservations = useCallback(
    (observations: Observation[]) => recordObservations(meta, observations),
    [meta],
  )

  return (
    <div
      key={question.slug}
      className="animate-round-enter flex h-screen flex-col overflow-hidden bg-surface-0"
    >
      <SessionBar />

      <header className="flex shrink-0 items-center gap-4 border-b border-surface-3 bg-surface-1 px-4 py-2.5">
        <Link
          href="/"
          className="text-[13px] text-ink-2 transition-colors hover:text-ink-0"
          aria-label="Back to home"
        >
          ←
        </Link>
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h1 className="truncate text-[13.5px] font-medium text-ink-0">{question.title}</h1>
          <span className="shrink-0 rounded border border-accent-dim px-1.5 py-px text-[10px] uppercase tracking-wide text-accent">
            {DISCUSSION_FORMAT_LABELS[question.format]}
          </span>
          <span className="shrink-0 text-[11px] uppercase tracking-wide text-ink-2">
            {question.difficulty}
          </span>
        </div>
        <span className="ml-auto shrink-0 text-[11px] text-ink-2">
          ~{question.expectedMinutes} min · answer out loud
        </span>
      </header>

      <main className="flex min-h-0 flex-1">
        <section
          className={`flex min-h-0 flex-col overflow-y-auto bg-surface-1 px-6 py-5 ${
            files.length > 0 ? 'w-[42%] min-w-[320px] max-w-[620px] shrink-0 border-r border-surface-3' : 'flex-1'
          }`}
        >
          <div className="mb-3 flex flex-wrap gap-1.5">
            {question.topics.map((topic) => (
              <span
                key={topic}
                className="rounded-full border border-surface-3 px-2 py-0.5 text-[10.5px] text-ink-2"
              >
                {topic}
              </span>
            ))}
          </div>

          <div className="prose-statement mb-5 text-[13px]">
            <ReactMarkdown>{question.statement}</ReactMarkdown>
          </div>

          <div className="rounded-lg border border-accent-dim/60 bg-accent-dim/10 px-4 py-3.5">
            <div className="mb-1.5 text-[10px] uppercase tracking-wider text-accent">
              The question
            </div>
            <p className="text-[14px] leading-relaxed text-ink-0">{question.prompt}</p>
          </div>

          <p className="mt-4 text-[12px] leading-relaxed text-ink-2">
            Press Start interview and answer out loud. It asks the question, then waits —
            the silence after it is yours, not a prompt to fill. The report afterwards
            scores what you covered separately from how you put it.
          </p>
        </section>

        {files.length > 0 && (
          <section className="flex min-w-0 flex-1 flex-col">
            {files.length > 1 && (
              <div className="flex shrink-0 overflow-x-auto border-b border-surface-3 bg-surface-1">
                {files.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => setActivePath(file.path)}
                    className={`whitespace-nowrap border-r border-surface-3 px-3.5 py-2 font-mono text-[12px] transition-colors ${
                      file.path === activePath
                        ? 'bg-surface-0 text-ink-0'
                        : 'text-ink-2 hover:text-ink-1'
                    }`}
                  >
                    {file.path}
                  </button>
                ))}
              </div>
            )}
            <p className="shrink-0 border-b border-surface-3 bg-surface-2 px-3.5 py-1.5 text-[11px] text-ink-2">
              Read-only — you&apos;re reviewing this, not editing it.
            </p>
            <div className="min-h-0 flex-1 overflow-hidden">
              {activeFile && (
                <Editor
                  key={activeFile.path}
                  value={activeFile.content}
                  language={activeFile.path.endsWith('.py') ? 'python' : 'typescript'}
                  readOnly
                  onChange={() => {}}
                />
              )}
            </div>
          </section>
        )}
        {/*
          Always present, unlike the code panel. A question with nothing to read
          is still a question to answer out loud, and this is the only way to do
          that — so it gets its own column rather than sharing one with material
          that may not exist.
        */}
        <section className="flex w-[340px] shrink-0 flex-col border-l border-surface-3">
          <VoicePanel
            problemSlug={question.slug}
            language="typescript"
            files={NO_FILES}
            activePath=""
            onRunTests={() => {}}
            onTranscript={onTranscript}
            onObservations={onObservations}
          />
        </section>
      </main>
    </div>
  )
}
