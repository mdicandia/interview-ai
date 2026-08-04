import type { CompareMode, Language, TestCase } from '@/lib/problems/types'
import { matches } from './compare'
import {
  DEFAULT_TIMEOUT_MS,
  RUNTIME_BOOT_TIMEOUT_MS,
  type RunSummary,
  type TestResult,
  type WorkerResponse,
} from './protocol'

/**
 * Owns the execution workers, compares their raw output against expectations, and
 * enforces the two wall-clock budgets the workers cannot enforce on themselves.
 *
 * A worker running `while True: pass` stops answering messages forever, so the
 * only reliable remedy is `terminate()` from out here. The per-case watchdog
 * resets on every streamed result; if it fires, we kill the worker, keep the
 * results that already arrived, and mark the rest. A separate boot timeout covers
 * a runtime that never starts at all.
 *
 * Workers are kept warm between runs — Pyodide takes seconds to boot, and paying
 * that on every Run press would make the tool unusable.
 */

export interface RunOptions {
  language: Language
  code: string
  entryPoint: string
  tests: TestCase[]
  compare?: CompareMode
  timeoutMs?: number
  /** Fires as each result arrives, so the panel fills in progressively. */
  onResult?: (result: TestResult) => void
}

export interface RunWorkspaceOptions {
  language: Language
  files: { path: string; content: string }[]
  testPath: string
  timeoutMs?: number
  onResult?: (result: TestResult) => void
}

export interface RunInFrameOptions extends Omit<RunWorkspaceOptions, 'language'> {
  /** The visible preview iframe. Owned by the UI, since the point is to watch it. */
  frame: HTMLIFrameElement
}

export type RuntimeStatus = 'idle' | 'booting' | 'ready' | 'running' | 'failed'

type StatusListener = (language: Language, status: RuntimeStatus) => void

interface Runtime {
  worker: Worker
  ready: Promise<void>
  status: RuntimeStatus
}

/**
 * Served from /public, not bundled — see the header comment in each worker file.
 * They are module workers so they can `import()` Pyodide and esbuild by URL.
 */
const WORKER_URL: Record<Language, string> = {
  python: '/workers/pyodide.worker.js',
  typescript: '/workers/js.worker.js',
}

export class RuntimeClient {
  #runtimes = new Map<Language, Runtime>()
  #listeners = new Set<StatusListener>()
  #runCounter = 0

  onStatusChange(listener: StatusListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #setStatus(language: Language, status: RuntimeStatus) {
    const runtime = this.#runtimes.get(language)
    if (runtime) runtime.status = status
    for (const listener of this.#listeners) listener(language, status)
  }

  /**
   * Starts a runtime without running anything, so the Pyodide download overlaps
   * with the candidate reading the problem instead of stalling their first Run.
   */
  preload(language: Language): void {
    // Failure is surfaced via the status listener and again when `run` awaits it.
    // Swallowing it here stops a boot failure from *also* being reported as an
    // unhandled rejection, which React's dev overlay treats as a crash.
    this.#ensure(language).ready.catch(() => {})
  }

  #ensure(language: Language): Runtime {
    const existing = this.#runtimes.get(language)
    if (existing) return existing

    const worker = new Worker(WORKER_URL[language], { type: 'module' })
    const runtime: Runtime = {
      worker,
      status: 'booting',
      ready: new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.#setStatus(language, 'failed')
          reject(
            new Error(
              `The ${language} runtime did not start within ${
                RUNTIME_BOOT_TIMEOUT_MS / 1000
              }s. Check the browser console.`,
            ),
          )
        }, RUNTIME_BOOT_TIMEOUT_MS)

        const settle = (fn: () => void) => {
          clearTimeout(timer)
          worker.removeEventListener('message', onMessage)
          fn()
        }

        const onMessage = (event: MessageEvent<WorkerResponse>) => {
          if (event.data.type === 'ready') {
            settle(() => {
              this.#setStatus(language, 'ready')
              resolve()
            })
          } else if (event.data.type === 'fatal') {
            const { message } = event.data
            settle(() => {
              this.#setStatus(language, 'failed')
              reject(new Error(message))
            })
          }
        }

        worker.addEventListener('message', onMessage)
        worker.addEventListener('error', (event) =>
          settle(() => {
            this.#setStatus(language, 'failed')
            reject(new Error(event.message || `Failed to load ${WORKER_URL[language]}`))
          }),
        )
      }),
    }

    // Same reasoning as `preload`: every consumer of `ready` handles failure, but
    // an untouched rejected promise would still be reported as unhandled.
    runtime.ready.catch(() => {})

    this.#runtimes.set(language, runtime)
    this.#setStatus(language, 'booting')
    return runtime
  }

  /** Kills a runtime so the next run gets a clean one. */
  #discard(language: Language) {
    const runtime = this.#runtimes.get(language)
    if (!runtime) return
    runtime.worker.terminate()
    this.#runtimes.delete(language)
    this.#setStatus(language, 'idle')
  }

  async run(options: RunOptions): Promise<RunSummary> {
    const {
      language,
      code,
      entryPoint,
      tests,
      compare = 'deep-equal',
      timeoutMs = DEFAULT_TIMEOUT_MS,
      onResult,
    } = options

    const runId = `run-${++this.#runCounter}`
    const startedAt = performance.now()
    const runtime = this.#ensure(language)

    try {
      await runtime.ready
    } catch (error) {
      return {
        runId,
        language,
        results: [],
        passed: 0,
        total: tests.length,
        compileError: error instanceof Error ? error.message : String(error),
        totalDurationMs: performance.now() - startedAt,
      }
    }

    this.#setStatus(language, 'running')

    return new Promise<RunSummary>((resolve) => {
      const results: TestResult[] = []
      let watchdog: ReturnType<typeof setTimeout>

      const finish = (extra?: Partial<RunSummary>) => {
        clearTimeout(watchdog)
        runtime.worker.removeEventListener('message', onMessage)
        resolve({
          runId,
          language,
          results,
          passed: results.filter((r) => r.status === 'pass').length,
          total: tests.length,
          totalDurationMs: performance.now() - startedAt,
          ...extra,
        })
      }

      // Fires only if the worker goes quiet mid-run, which in practice means the
      // candidate's code is stuck in a loop.
      const onTimeout = () => {
        const stalledIndex = results.length
        const stalled = tests[stalledIndex]
        if (stalled) {
          results.push({
            name: stalled.name,
            status: 'timeout',
            hidden: stalled.hidden ?? false,
            args: stalled.args,
            expected: stalled.expected,
            error: `Timed out after ${timeoutMs}ms — likely an infinite loop.`,
            durationMs: timeoutMs,
          })
        }
        for (const test of tests.slice(stalledIndex + 1)) {
          results.push({
            name: test.name,
            status: 'skipped',
            hidden: test.hidden ?? false,
            args: test.args,
            expected: test.expected,
            error: 'Skipped — an earlier test timed out.',
            durationMs: 0,
          })
        }
        // The worker is wedged and unrecoverable; the next run gets a fresh one.
        this.#discard(language)
        finish()
      }

      const armWatchdog = () => {
        clearTimeout(watchdog)
        watchdog = setTimeout(onTimeout, timeoutMs)
      }

      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data
        // Ignore anything from a superseded run.
        if ('runId' in message && message.runId !== runId) return

        switch (message.type) {
          case 'case-result': {
            const test = tests[message.index]
            if (!test) break
            const passed = message.ok && matches(message.value, test.expected, compare)
            const result: TestResult = {
              name: test.name,
              status: message.ok ? (passed ? 'pass' : 'fail') : 'error',
              hidden: test.hidden ?? false,
              args: test.args,
              expected: test.expected,
              ...(message.ok ? { actual: message.value } : { error: message.error }),
              stdout: message.stdout,
              durationMs: message.durationMs,
            }
            results.push(result)
            onResult?.(result)
            armWatchdog()
            break
          }
          case 'compile-error':
            this.#setStatus(language, 'ready')
            finish({ compileError: message.message })
            break
          case 'run-complete':
            this.#setStatus(language, 'ready')
            finish()
            break
          case 'fatal':
            this.#discard(language)
            finish({ compileError: message.message })
            break
        }
      }

      runtime.worker.addEventListener('message', onMessage)
      armWatchdog()
      runtime.worker.postMessage({
        type: 'run',
        runId,
        code,
        entryPoint,
        cases: tests.map((t) => t.args),
      })
    })
  }

  /**
   * Runs a multi-file problem's test suite.
   *
   * Differs from `run` in that the test list isn't known until the worker has
   * loaded the suite and reported back, so `total` is filled in from
   * `suite-start` rather than from the problem definition.
   */
  async runWorkspace(options: RunWorkspaceOptions): Promise<RunSummary> {
    const { language, files, testPath, timeoutMs = DEFAULT_TIMEOUT_MS, onResult } = options

    const runId = `run-${++this.#runCounter}`
    const startedAt = performance.now()
    const runtime = this.#ensure(language)

    try {
      await runtime.ready
    } catch (error) {
      return {
        runId,
        language,
        results: [],
        passed: 0,
        total: 0,
        compileError: error instanceof Error ? error.message : String(error),
        totalDurationMs: performance.now() - startedAt,
      }
    }

    this.#setStatus(language, 'running')

    return new Promise<RunSummary>((resolve) => {
      const results: TestResult[] = []
      let discovered: string[] = []
      let watchdog: ReturnType<typeof setTimeout>

      const finish = (extra?: Partial<RunSummary>) => {
        clearTimeout(watchdog)
        runtime.worker.removeEventListener('message', onMessage)
        resolve({
          runId,
          language,
          results,
          passed: results.filter((r) => r.status === 'pass').length,
          total: discovered.length || results.length,
          totalDurationMs: performance.now() - startedAt,
          ...extra,
        })
      }

      const onTimeout = () => {
        const stalled = discovered[results.length]
        if (stalled) {
          results.push({
            name: stalled,
            status: 'timeout',
            hidden: false,
            error: `Timed out after ${timeoutMs}ms — likely an infinite loop.`,
            durationMs: timeoutMs,
          })
        }
        for (const name of discovered.slice(results.length)) {
          results.push({
            name,
            status: 'skipped',
            hidden: false,
            error: 'Skipped — an earlier test timed out.',
            durationMs: 0,
          })
        }
        this.#discard(language)
        finish()
      }

      const armWatchdog = () => {
        clearTimeout(watchdog)
        watchdog = setTimeout(onTimeout, timeoutMs)
      }

      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data
        if ('runId' in message && message.runId !== runId) return

        switch (message.type) {
          case 'suite-start':
            discovered = message.tests
            armWatchdog()
            break
          case 'test-outcome': {
            const result: TestResult = {
              name: message.name,
              status: message.ok ? 'pass' : 'fail',
              hidden: false,
              error: message.error,
              stdout: message.stdout,
              durationMs: message.durationMs,
            }
            results.push(result)
            onResult?.(result)
            armWatchdog()
            break
          }
          case 'compile-error':
            this.#setStatus(language, 'ready')
            finish({ compileError: message.message })
            break
          case 'run-complete':
            this.#setStatus(language, 'ready')
            finish()
            break
          case 'fatal':
            this.#discard(language)
            finish({ compileError: message.message })
            break
        }
      }

      runtime.worker.addEventListener('message', onMessage)
      armWatchdog()
      runtime.worker.postMessage({ type: 'run-workspace', runId, files, testPath })
    })
  }

  /**
   * Runs a frontend problem: the worker bundles, the iframe renders and executes.
   *
   * Split that way because the two halves need different things — esbuild lives in
   * the worker and shouldn't be instantiated twice, while the DOM only exists on
   * the main thread.
   */
  async runInFrame(options: RunInFrameOptions): Promise<RunSummary> {
    const { frame, files, testPath, timeoutMs = DEFAULT_TIMEOUT_MS, onResult } = options

    const runId = `run-${++this.#runCounter}`
    const startedAt = performance.now()
    // Frontend problems are TypeScript, so the bundling runtime is the JS worker.
    const runtime = this.#ensure('typescript')

    const bail = (compileError: string): RunSummary => ({
      runId,
      language: 'typescript',
      results: [],
      passed: 0,
      total: 0,
      compileError,
      totalDurationMs: performance.now() - startedAt,
    })

    try {
      await runtime.ready
    } catch (error) {
      return bail(error instanceof Error ? error.message : String(error))
    }

    this.#setStatus('typescript', 'running')

    const bundle = await new Promise<{ code?: string; error?: string }>((resolve) => {
      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data
        if ('runId' in message && message.runId !== runId) return
        if (message.type === 'bundle') {
          runtime.worker.removeEventListener('message', onMessage)
          resolve({ code: message.code })
        } else if (message.type === 'compile-error') {
          runtime.worker.removeEventListener('message', onMessage)
          resolve({ error: message.message })
        } else if (message.type === 'fatal') {
          runtime.worker.removeEventListener('message', onMessage)
          resolve({ error: message.message })
        }
      }
      runtime.worker.addEventListener('message', onMessage)
      runtime.worker.postMessage({ type: 'bundle', runId, files, testPath })
    })

    if (!bundle.code) {
      this.#setStatus('typescript', 'ready')
      return bail(bundle.error ?? 'The bundle failed for an unknown reason.')
    }

    const { runInFrame } = await import('./frame')
    const outcome = await runInFrame(frame, bundle.code, { timeoutMs, onResult })

    this.#setStatus('typescript', 'ready')

    return {
      runId,
      language: 'typescript',
      results: outcome.results,
      passed: outcome.results.filter((r) => r.status === 'pass').length,
      total: outcome.discovered.length || outcome.results.length,
      compileError: outcome.compileError,
      totalDurationMs: performance.now() - startedAt,
    }
  }

  dispose(): void {
    for (const language of [...this.#runtimes.keys()]) this.#discard(language)
    this.#listeners.clear()
  }
}
