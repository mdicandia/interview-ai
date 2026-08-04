'use client'

import Link from 'next/link'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { ClientQuestion } from '@/questions'
import { DISCUSSION_FORMAT_LABELS } from '@/lib/problems/types'
import { Editor } from './Editor'
import { SessionBar } from './SessionBar'

/**
 * Displays a non-coding question. Read-only by design.
 *
 * There is no answer box and no rubric reveal: a verbal answer can't be graded
 * by anything that exists yet, and a self-marked checklist is a different
 * exercise from being questioned. This shows the prompt and any material to read,
 * you answer out loud, and the timer runs — which is enough for a session to
 * include the verbal rounds a real loop has.
 *
 * The expected points and probes never reach the browser at all; they're stripped
 * server-side in `toClientQuestion`.
 */
export function QuestionRoom({ question }: { question: ClientQuestion }) {
  const files = question.context ?? []
  const [activePath, setActivePath] = useState(files[0]?.path ?? '')
  const activeFile = files.find((f) => f.path === activePath) ?? files[0]

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface-0">
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
            No scoring yet — the interviewer that grades these hasn&apos;t been built. Answer
            it aloud as you would in the real thing and use the timer to keep yourself
            honest about length.
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
      </main>
    </div>
  )
}
