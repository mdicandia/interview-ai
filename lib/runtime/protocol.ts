/**
 * The contract between the main thread and the two execution workers, which live
 * as plain JS in public/workers/ (see those files for why they aren't bundled).
 *
 * The workers are dumb executors: they run code and report raw return values.
 * Comparison against expectations happens on the main thread, so both languages
 * share one comparator instead of each reimplementing equality.
 *
 * Results stream back one case at a time rather than as a single batch. That is
 * what makes timeouts survivable: candidate code with an infinite loop wedges the
 * worker's only thread, and nothing running *inside* the worker can break out of
 * it. (Pyodide's interrupt buffer could, but it needs a SharedArrayBuffer, which
 * needs COOP/COEP headers — a lot of machinery for a local practice tool.) So the
 * main thread keeps a watchdog, terminates the worker when it goes quiet, and
 * still has every result that arrived before the hang.
 */

import type { Language } from '@/lib/problems/types'

/** Main thread → worker. `cases` is one argument-array per test. */
export interface RunRequest {
  type: 'run'
  runId: string
  code: string
  entryPoint: string
  cases: unknown[][]
}

/**
 * Main thread → worker, for multi-file practical problems.
 *
 * Unlike an algorithm run, the tests aren't known up front — they're whatever the
 * suite file defines — so the worker discovers them and reports the names back
 * before running any. Python collects module-level `test_*` functions; TypeScript
 * collects exports whose names start with `test`.
 */
export interface RunWorkspaceRequest {
  type: 'run-workspace'
  runId: string
  files: { path: string; content: string }[]
  /** The file to execute; everything else is reachable via imports. */
  testPath: string
}

export type WorkerRequest = RunRequest | RunWorkspaceRequest

/** Worker → main thread. */
export type WorkerResponse =
  /** Runtime booted and is ready to accept a run. */
  | { type: 'ready' }
  /** Code failed to parse, or the entry point is missing; no cases will follow. */
  | { type: 'compile-error'; runId: string; message: string }
  | {
      type: 'case-result'
      runId: string
      index: number
      ok: boolean
      /** Present when `ok`. The raw return value, already JSON-shaped. */
      value?: unknown
      /** Present when `!ok`. Language-native error text. */
      error?: string
      stdout?: string
      durationMs: number
    }
  /** Workspace run: the suite loaded and these tests were discovered, in order. */
  | { type: 'suite-start'; runId: string; tests: string[] }
  /** Workspace run: one test finished. The error text carries the assertion detail. */
  | {
      type: 'test-outcome'
      runId: string
      name: string
      ok: boolean
      error?: string
      stdout?: string
      durationMs: number
    }
  | { type: 'run-complete'; runId: string }
  /** Frontend problems: bundled JS for the iframe to host. See lib/runtime/frame.ts. */
  | { type: 'bundle'; runId: string; code: string }
  /** The runtime itself failed to start — not the candidate's fault. */
  | { type: 'fatal'; message: string }

export type TestStatus = 'pass' | 'fail' | 'error' | 'timeout' | 'skipped'

export interface TestResult {
  name: string
  status: TestStatus
  hidden: boolean
  /**
   * Only present for algorithm runs, where the harness supplies the arguments and
   * knows the expected value. In a workspace run the assertion lives inside the
   * candidate's own test file, so the failure detail arrives as `error` text
   * instead — which is also what they'd see from pytest or vitest.
   */
  args?: unknown[]
  expected?: unknown
  actual?: unknown
  error?: string
  stdout?: string
  durationMs: number
}

export interface RunSummary {
  runId: string
  language: Language
  results: TestResult[]
  passed: number
  total: number
  /**
   * Set when the submission failed before any case could run — a syntax error, a
   * missing entry point, or a runtime that wouldn't start. Distinguishing this
   * from "tests failed" matters: the interviewer should say "that won't parse"
   * rather than "your logic is wrong".
   */
  compileError?: string
  totalDurationMs: number
}

/**
 * Wall-clock budget per case. Generous, because the first call into freshly
 * defined Python is slower than steady state.
 */
export const DEFAULT_TIMEOUT_MS = 5_000

/**
 * Pyodide fetches ~12MB and boots CPython. Without a ceiling here, a runtime that
 * never comes up leaves the UI saying "running…" forever.
 */
export const RUNTIME_BOOT_TIMEOUT_MS = 60_000
