'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { ClientProblem } from '@/problems'
import {
  LANGUAGE_LABELS,
  VARIANT_LABELS,
  supportedLanguages,
  type Language,
  type WorkspaceFile,
} from '@/lib/problems/types'
import { RuntimeClient, type RuntimeStatus } from '@/lib/runtime/client'
import type { RunSummary, TestResult } from '@/lib/runtime/protocol'
import { Editor } from './Editor'
import { SessionBar } from './SessionBar'
import { TestPanel } from './TestPanel'

const BOOT_COPY: Partial<Record<RuntimeStatus, string>> = {
  booting: 'Starting the runtime… (Python downloads ~12MB the first time)',
  failed: 'The runtime failed to start. Check the browser console for details.',
}

const SOLUTION_FILE: Record<Language, string> = {
  python: 'solution.py',
  typescript: 'solution.ts',
}

/**
 * Both problem kinds are rendered as a set of files, which is what lets one
 * component serve both: an algorithm problem is just a workspace with a single
 * editable file, so the tab strip hides itself and everything else is shared.
 */
function initialFiles(problem: ClientProblem, language: Language): WorkspaceFile[] {
  if (problem.kind === 'workspace') return problem.files[language] ?? []
  return [{ path: SOLUTION_FILE[language], content: problem.starterCode[language] ?? '' }]
}

type Drafts = Record<Language, Record<string, string>>

function initialDrafts(problem: ClientProblem): Drafts {
  const drafts = {} as Drafts
  for (const language of supportedLanguages(problem)) {
    drafts[language] = Object.fromEntries(
      initialFiles(problem, language).map((f) => [f.path, f.content]),
    )
  }
  return drafts
}

export function InterviewRoom({ problem }: { problem: ClientProblem }) {
  // Not every problem offers both languages — a SQL problem needs Pyodide's
  // sqlite3, a React problem is TypeScript by nature — so the default comes from
  // the problem rather than being hard-coded.
  const languages = supportedLanguages(problem)
  const [language, setLanguage] = useState<Language>(languages[0])

  // Per-language drafts, so switching to compare approaches doesn't destroy work.
  const [drafts, setDrafts] = useState<Drafts>(() => initialDrafts(problem))

  const files = useMemo(() => initialFiles(problem, language), [problem, language])
  const firstEditable = files.find((f) => !f.readOnly)?.path ?? files[0].path

  // File paths differ per language (`retry.py` vs `retry.ts`), so a tab selected
  // in one language may not exist in the other. Rather than syncing that in an
  // effect, the open tab is *derived*: the selection is honoured when it's still
  // valid and quietly falls back when it isn't.
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const activePath =
    selectedPath && files.some((f) => f.path === selectedPath) ? selectedPath : firstEditable

  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [streaming, setStreaming] = useState<TestResult[]>([])
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState<RuntimeStatus>('idle')

  // Frontend problems render into this iframe. It is owned here rather than by
  // the runtime because it has to stay on screen — watching the component is the
  // point, not an implementation detail of running the tests.
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const isFrontend = problem.kind === 'workspace' && problem.variant === 'frontend'

  const runtimeRef = useRef<RuntimeClient | null>(null)

  /**
   * Lazily constructs the client on demand rather than during render.
   *
   * The unmount cleanup disposes the client and clears the ref, and in React
   * StrictMode dev double-invokes effects: mount → cleanup → mount. Initialising
   * the ref during render would never run again for that second mount (no
   * re-render happens in between), leaving the ref null and Run silently doing
   * nothing. Creating it through a getter makes every consumer self-healing.
   */
  const getClient = useCallback(() => {
    runtimeRef.current ??= new RuntimeClient()
    return runtimeRef.current
  }, [])

  // The status listener is registered once, but needs to know which language is
  // on screen *now*. A ref gives it that without re-subscribing on every switch.
  const languageRef = useRef(language)
  useEffect(() => {
    languageRef.current = language
  }, [language])

  useEffect(() => {
    const client = getClient()
    const unsubscribe = client.onStatusChange((lang, next) => {
      if (lang === languageRef.current) setStatus(next)
    })
    return () => {
      unsubscribe()
      client.dispose()
      runtimeRef.current = null
    }
  }, [getClient])

  // Start the runtime download while the candidate is still reading the problem,
  // so the first Run isn't a 10-second stall.
  useEffect(() => {
    getClient().preload(language)
  }, [getClient, language])

  const activeFile = files.find((f) => f.path === activePath) ?? files[0]
  const code = drafts[language][activeFile.path] ?? ''

  const setCode = useCallback(
    (next: string) =>
      setDrafts((prev) => ({
        ...prev,
        [language]: { ...prev[language], [activeFile.path]: next },
      })),
    [language, activeFile.path],
  )

  const run = useCallback(async () => {
    if (running) return
    const client = getClient()

    setRunning(true)
    setSummary(null)
    setStreaming([])

    const onResult = (r: TestResult) => setStreaming((prev) => [...prev, r])

    // `language` is always one the problem declares, so these fallbacks are
    // defensive only — but they keep a malformed problem definition from
    // silently running the wrong thing.
    const workspaceFiles =
      problem.kind === 'workspace'
        ? files.map((f) => ({
            path: f.path,
            content: f.readOnly ? f.content : (drafts[language][f.path] ?? f.content),
          }))
        : []

    if (isFrontend && frameRef.current) {
      const frameResult = await client.runInFrame({
        frame: frameRef.current,
        files: workspaceFiles,
        testPath: problem.kind === 'workspace' ? (problem.testPath.typescript ?? '') : '',
        onResult,
      })
      setSummary(frameResult)
      setRunning(false)
      return
    }

    const result =
      problem.kind === 'workspace'
        ? await client.runWorkspace({
            language,
            // Read-only files always run as authored, never from the draft.
            // CodeMirror's readOnly blocks *typing*, but not programmatic edits,
            // so this is the actual guarantee that the spec can't be rewritten to
            // make a red suite go green.
            files: workspaceFiles,
            testPath: problem.testPath[language] ?? '',
            onResult,
          })
        : await client.run({
            language,
            code: drafts[language][SOLUTION_FILE[language]] ?? '',
            entryPoint: problem.entryPoint[language] ?? '',
            tests: problem.tests,
            compare: problem.compare ?? 'deep-equal',
            onResult,
          })

    setSummary(result)
    setRunning(false)
  }, [drafts, files, getClient, isFrontend, language, problem, running])

  const resetToStarter = useCallback(() => {
    setDrafts((prev) => ({
      ...prev,
      [language]: Object.fromEntries(
        initialFiles(problem, language).map((f) => [f.path, f.content]),
      ),
    }))
    setSummary(null)
    setStreaming([])
  }, [language, problem])

  const bootMessage = useMemo(() => {
    if (running || summary) return null
    return BOOT_COPY[status] ?? null
  }, [running, status, summary])

  const showTabs = files.length > 1

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface-0">
      <SessionBar />

      <header className="flex shrink-0 items-center gap-4 border-b border-surface-3 bg-surface-1 px-4 py-2.5">
        <Link
          href="/"
          className="text-[13px] text-ink-2 transition-colors hover:text-ink-0"
          aria-label="Back to problem list"
        >
          ←
        </Link>
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h1 className="truncate text-[13.5px] font-medium text-ink-0">{problem.title}</h1>
          {problem.kind === 'workspace' && (
            <span className="shrink-0 rounded border border-accent-dim px-1.5 py-px text-[10px] uppercase tracking-wide text-accent">
              {VARIANT_LABELS[problem.variant]}
            </span>
          )}
          <span className="shrink-0 text-[11px] uppercase tracking-wide text-ink-2">
            {problem.difficulty}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div
            className={`flex rounded-md border border-surface-3 p-0.5 ${
              languages.length > 1 ? '' : 'opacity-60'
            }`}
            role="group"
            aria-label="Language"
          >
            {languages.map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => setLanguage(lang)}
                aria-pressed={language === lang}
                className={`rounded px-2.5 py-1 text-[12px] transition-colors ${
                  language === lang ? 'bg-surface-3 text-ink-0' : 'text-ink-2 hover:text-ink-1'
                }`}
              >
                {LANGUAGE_LABELS[lang]}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={resetToStarter}
            className="rounded-md border border-surface-3 px-2.5 py-1.5 text-[12px] text-ink-2 transition-colors hover:text-ink-0"
          >
            Reset
          </button>

          <button
            type="button"
            onClick={run}
            disabled={running || status === 'failed'}
            className="rounded-md bg-accent px-3.5 py-1.5 text-[12px] font-medium text-surface-0 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? 'Running…' : 'Run'}
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1">
        <section className="flex w-[38%] min-w-[300px] max-w-[560px] shrink-0 flex-col overflow-y-auto border-r border-surface-3 bg-surface-1 px-5 py-4">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {problem.topics.map((topic) => (
              <span
                key={topic}
                className="rounded-full border border-surface-3 px-2 py-0.5 text-[10.5px] text-ink-2"
              >
                {topic}
              </span>
            ))}
          </div>
          {problem.kind === 'workspace' && (
            <p className="mb-4 rounded-md border border-accent-dim/50 bg-accent-dim/10 px-3 py-2 text-[12.5px] text-ink-0">
              {problem.goal}
            </p>
          )}
          <div className="prose-statement text-[13px]">
            <ReactMarkdown>{problem.statement}</ReactMarkdown>
          </div>
        </section>

        <section className="flex min-w-0 flex-1 flex-col">
          {showTabs && (
            <div
              className="flex shrink-0 items-stretch overflow-x-auto border-b border-surface-3 bg-surface-1"
              role="tablist"
              aria-label="Files"
            >
              {files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  role="tab"
                  aria-selected={file.path === activePath}
                  onClick={() => setSelectedPath(file.path)}
                  className={`flex items-center gap-1.5 whitespace-nowrap border-r border-surface-3 px-3.5 py-2 font-mono text-[12px] transition-colors ${
                    file.path === activePath
                      ? 'bg-surface-0 text-ink-0'
                      : 'text-ink-2 hover:text-ink-1'
                  }`}
                >
                  {file.path}
                  {file.readOnly && (
                    <span
                      className="text-[10px] text-ink-2"
                      title="Read-only — the tests are the specification"
                    >
                      ●
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {activeFile.readOnly && (
            <p className="shrink-0 border-b border-surface-3 bg-surface-2 px-3.5 py-1.5 text-[11px] text-ink-2">
              Read-only — this file is the specification. Fix the code, not the test.
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-hidden">
            <Editor
              key={`${language}:${activeFile.path}`}
              value={code}
              language={language}
              readOnly={activeFile.readOnly ?? false}
              onChange={setCode}
              onRun={run}
            />
          </div>
          <div className="flex h-[42%] min-h-[180px] shrink-0 overflow-hidden">
            {isFrontend && (
              <div className="flex min-w-0 flex-1 flex-col border-r border-t border-surface-3">
                <div className="flex items-center gap-2 border-b border-surface-3 bg-surface-1 px-3 py-2">
                  <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
                    Preview
                  </h2>
                  <span className="text-[11px] text-ink-2">live — renders on every run</span>
                </div>
                <iframe
                  ref={frameRef}
                  title="Component preview"
                  // allow-scripts without allow-same-origin puts the frame on an
                  // opaque origin: candidate code can run, but cannot reach this
                  // document, its storage, or its cookies.
                  sandbox="allow-scripts"
                  className="min-h-0 flex-1 border-0 bg-white"
                />
              </div>
            )}
            <div className={isFrontend ? 'min-w-0 flex-1 overflow-hidden' : 'min-w-0 flex-1'}>
              <TestPanel
                summary={summary}
                streaming={streaming}
                running={running}
                bootMessage={bootMessage}
              />
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
