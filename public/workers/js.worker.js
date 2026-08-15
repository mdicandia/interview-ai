/**
 * TypeScript / JavaScript execution worker.
 *
 * Plain JavaScript served from /public for the same reason as the Python worker:
 * a bundler-compiled worker gets Turbopack's chunk runtime injected, which will
 * not initialise inside a worker. See public/workers/pyodide.worker.js.
 *
 * Types are *stripped*, not *checked* — esbuild does no semantic analysis. That
 * matches a real interview: nobody is blocked from running code over a slightly
 * wrong type, and noticing it is the interviewer's job. Syntax errors that
 * genuinely prevent execution are still caught.
 *
 * Protocol: see lib/runtime/protocol.ts
 */

const ESBUILD_URL = new URL('/esbuild/browser.min.js', self.location.origin).href
const ESBUILD_WASM_URL = new URL('/esbuild/esbuild.wasm', self.location.origin).href

let esbuild = null
let stdoutBuffer = []

async function boot() {
  if (esbuild) return esbuild
  const mod = await import(ESBUILD_URL)
  await mod.initialize({ wasmURL: ESBUILD_WASM_URL })
  esbuild = mod
  return mod
}

function installConsoleCapture() {
  const format = (args) =>
    args
      .map((a) => {
        if (typeof a === 'string') return a
        try {
          return JSON.stringify(a)
        } catch {
          return String(a)
        }
      })
      .join(' ')

  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    console[level] = (...args) => stdoutBuffer.push(`${format(args)}\n`)
  }
}

function drainStdout() {
  if (stdoutBuffer.length === 0) return undefined
  const text = stdoutBuffer.join('')
  stdoutBuffer = []
  return text.length > 0 ? text : undefined
}

function formatBuildError(error) {
  if (Array.isArray(error?.errors) && error.errors.length > 0) {
    return error.errors
      .map((e) => (e.location ? `Line ${e.location.line}: ${e.text}` : e.text))
      .join('\n')
  }
  return error instanceof Error ? error.message : String(error)
}

/** Keeps the stack but drops the harness frames below the candidate's own code. */
function formatRuntimeError(error) {
  if (!(error instanceof Error)) return String(error)
  const stack = error.stack ?? `${error.name}: ${error.message}`
  const lines = stack.split('\n')
  const cut = lines.findIndex((line) => line.includes('js.worker') || line.includes('at run '))
  return (cut > 0 ? lines.slice(0, cut) : lines).join('\n').trim()
}

async function run({ runId, code, entryPoint, cases }) {
  const build = await boot()

  let js
  try {
    const out = await build.transform(code, { loader: 'ts', target: 'es2022' })
    js = out.code
  } catch (error) {
    self.postMessage({ type: 'compile-error', runId, message: formatBuildError(error) })
    return
  }

  // `new Function` gives the code its own scope while still reaching worker
  // globals, and — unlike an ES module — lets us grab a top-level binding by name.
  let entry
  try {
    entry = new Function(
      `${js}\n;return typeof ${entryPoint} === "function" ? ${entryPoint} : undefined;`,
    )()
  } catch (error) {
    self.postMessage({ type: 'compile-error', runId, message: formatRuntimeError(error) })
    return
  }

  if (typeof entry !== 'function') {
    self.postMessage({
      type: 'compile-error',
      runId,
      message:
        `No function named \`${entryPoint}\` was found.\n\n` +
        `Declare a top-level function called \`${entryPoint}\` — a default export ` +
        `or a method on an object won't be picked up.`,
    })
    return
  }

  for (let index = 0; index < cases.length; index++) {
    const started = performance.now()
    stdoutBuffer = []
    try {
      // Clone the arguments so a solution that mutates its input in place can't
      // corrupt a later case's expectations.
      const value = await entry(...structuredClone(cases[index]))
      self.postMessage({
        type: 'case-result',
        runId,
        index,
        ok: true,
        value,
        stdout: drainStdout(),
        durationMs: performance.now() - started,
      })
    } catch (error) {
      self.postMessage({
        type: 'case-result',
        runId,
        index,
        ok: false,
        error: formatRuntimeError(error),
        stdout: drainStdout(),
        durationMs: performance.now() - started,
      })
    }
  }

  self.postMessage({ type: 'run-complete', runId })
}

/* ------------------------------------------------------- workspace problems */

/**
 * Assertions available to test files as `import { ... } from 'harness'`.
 *
 * Injected as a virtual module rather than shipped as a file in every problem:
 * it keeps one implementation, and importing assertions from a module you don't
 * own is exactly what `node:assert` or `vitest` look like anyway. Python needs no
 * equivalent — bare `assert` is already idiomatic there.
 */
const HARNESS_MODULE = `
export function equal(actual, expected, message) {
  if (!Object.is(actual, expected)) {
    throw new Error(
      (message ? message + '\\n' : '') +
      'expected ' + JSON.stringify(expected) + ' but got ' + JSON.stringify(actual)
    )
  }
}

// Object keys are sorted before comparing, so a result built in a different
// insertion order still compares equal — otherwise a correct solution could fail
// purely because it populated a map in a different sequence.
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
      .join(',') +
    '}'
  )
}

export function deepEqual(actual, expected, message) {
  const a = canonical(actual)
  const b = canonical(expected)
  if (a !== b) {
    throw new Error((message ? message + '\\n' : '') + 'expected ' + b + '\\nbut got  ' + a)
  }
}

export function ok(value, message) {
  if (!value) throw new Error(message || 'expected a truthy value, got ' + JSON.stringify(value))
}

export function throws(fn, message) {
  try {
    fn()
  } catch {
    return
  }
  throw new Error(message || 'expected the function to throw, but it returned normally')
}
`

/**
 * Resolves a bare or relative specifier against the in-memory file map.
 *
 * Extension order matters: `./Counter` must find `Counter.tsx`, and a component
 * file is far more likely to be .tsx than .ts.
 */
const EXTENSIONS = ['', '.tsx', '.ts', '.jsx', '.js']

function resolveVirtual(specifier, fileMap) {
  const cleaned = specifier.replace(/^\.\//, '')
  for (const extension of EXTENSIONS) {
    if (fileMap.has(cleaned + extension)) return cleaned + extension
  }
  return null
}

/**
 * Every React entry point maps to the single pre-bundled vendor file built at
 * install time (see scripts/copy-runtime-assets.mjs). There is no node_modules in
 * the browser to resolve against, and fetching from a CDN would break offline use.
 */
const REACT_SPECIFIERS = new Set(['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'])

let reactSourcePromise = null
function reactSource() {
  reactSourcePromise ??= fetch(new URL('/vendor/react.js', self.location.origin).href).then((r) => {
    if (!r.ok) throw new Error('react vendor bundle missing — run `pnpm copy-assets`')
    return r.text()
  })
  return reactSourcePromise
}

/**
 * Shared esbuild plugin factory for both the worker suite runner and the iframe
 * bundle, so the two paths resolve modules identically.
 */
function virtualFsPlugin(fileMap, { react = false, harness = HARNESS_MODULE } = {}) {
  return {
    name: 'virtual-fs',
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        if (args.path === 'harness') return { path: 'harness', namespace: 'virtual' }
        if (react && REACT_SPECIFIERS.has(args.path)) {
          return { path: 'react-vendor', namespace: 'virtual' }
        }
        const resolved = resolveVirtual(args.path, fileMap)
        if (resolved) return { path: resolved, namespace: 'virtual' }
        return {
          errors: [
            {
              text:
                `Cannot resolve "${args.path}". Available files: ` +
                [...fileMap.keys()].join(', '),
            },
          ],
        }
      })
      b.onLoad({ filter: /.*/, namespace: 'virtual' }, async (args) => {
        if (args.path === 'harness') return { contents: harness, loader: 'ts' }
        if (args.path === 'react-vendor') return { contents: await reactSource(), loader: 'js' }
        return { contents: fileMap.get(args.path), loader: 'tsx' }
      })
    },
  }
}

async function runWorkspace({ runId, files, testPath }) {
  const build = await boot()
  const fileMap = new Map(files.map((f) => [f.path, f.content]))

  // esbuild has no filesystem here, so a plugin has to answer every resolve and
  // load. Bundling (rather than transforming each file) is what makes imports
  // between the candidate's files work.
  let bundled
  try {
    const result = await build.build({
      entryPoints: [testPath],
      bundle: true,
      write: false,
      format: 'iife',
      globalName: '__suite',
      target: 'es2022',
      plugins: [virtualFsPlugin(fileMap)],
    })
    bundled = result.outputFiles[0].text
  } catch (error) {
    self.postMessage({ type: 'compile-error', runId, message: formatBuildError(error) })
    return
  }

  let suite
  try {
    suite = new Function(`${bundled}\n;return __suite;`)()
  } catch (error) {
    self.postMessage({ type: 'compile-error', runId, message: formatRuntimeError(error) })
    return
  }

  const names = Object.keys(suite ?? {})
    .filter((k) => k.startsWith('test') && typeof suite[k] === 'function')
    .sort()

  if (names.length === 0) {
    self.postMessage({
      type: 'compile-error',
      runId,
      message: `No tests found in ${testPath}.\n\nTests must be exported functions whose names start with \`test\`.`,
    })
    return
  }

  self.postMessage({ type: 'suite-start', runId, tests: names })

  for (const name of names) {
    const started = performance.now()
    stdoutBuffer = []
    let ok = true
    let error
    try {
      await suite[name]()
    } catch (e) {
      ok = false
      error = formatRuntimeError(e)
    }
    self.postMessage({
      type: 'test-outcome',
      runId,
      name,
      ok,
      error,
      stdout: drainStdout(),
      durationMs: performance.now() - started,
    })
  }

  self.postMessage({ type: 'run-complete', runId })
}

/* --------------------------------------------------- frontend (iframe) bundle */

/**
 * The `harness` module for frontend problems: the same assertions plus DOM
 * helpers, since those tests need to mount a component and poke at it.
 *
 * `render` deliberately mounts into the visible #root rather than a detached
 * node — the whole reason frontend problems run in an iframe instead of a
 * headless DOM is that you can watch the component while you debug it.
 */
const DOM_HARNESS_MODULE = `
${HARNESS_MODULE}

import { createRoot, act } from 'react'

/**
 * Re-exported so a test can wrap its own asynchronous state changes.
 *
 * The helpers below cover anything *they* trigger, but a test that resolves a
 * promise the component is awaiting causes an update React never saw enter an
 * act scope — and warns about it. Awaiting the async form of act around the
 * release flushes the microtask inside the scope.
 *
 * No backticks in this comment: it lives inside a template literal, and one
 * would end the string here rather than at the intended place.
 */
export { act }

function mountPoint() {
  const root = document.getElementById('root')
  root.innerHTML = ''
  const container = document.createElement('div')
  root.appendChild(container)
  return container
}

export function render(element) {
  // Remembered so the preview can be brought back after the suite finishes.
  // Tests unmount as they should, which would otherwise leave a blank pane —
  // exactly when the candidate most wants to look at the component.
  globalThis.__lastRendered = element

  const container = mountPoint()
  const root = createRoot(container)
  act(() => { root.render(element) })
  return {
    container,
    get text() { return container.textContent },
    find: (selector) => container.querySelector(selector),
    findAll: (selector) => Array.from(container.querySelectorAll(selector)),
    rerender: (next) => act(() => { root.render(next) }),
    unmount: () => act(() => { root.unmount() }),
  }
}

export function click(element) {
  if (!element) throw new Error('click() was given nothing to click')
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

/** Sets a controlled input's value the way React expects, then fires 'input'. */
export function typeInto(element, value) {
  if (!element) throw new Error('typeInto() was given nothing to type into')
  const proto = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  act(() => {
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/**
 * Presses a key on an element. Needed for anything with keyboard navigation,
 * which for a component build is usually half the specification.
 */
export function press(element, key, init = {}) {
  if (!element) throw new Error('press() was given nothing to press')
  act(() => {
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    )
  })
}

/** Focuses an element, so subsequent key presses land where you expect. */
export function focus(element) {
  if (!element) throw new Error('focus() was given nothing to focus')
  act(() => { element.focus() })
}

/** Lets effects, timers, and pending state updates settle. */
export async function settle(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

/**
 * Re-mounts whatever was last rendered, so the preview shows a live component
 * once the suite is done. Called by the frame runner, never by a test.
 */
globalThis.__replayLastRender = () => {
  const element = globalThis.__lastRendered
  if (!element) return
  const container = mountPoint()
  createRoot(container).render(element)
}
`

async function bundleForFrame({ runId, files, testPath }) {
  const build = await boot()
  const fileMap = new Map(files.map((f) => [f.path, f.content]))

  try {
    const result = await build.build({
      entryPoints: [testPath],
      bundle: true,
      write: false,
      format: 'iife',
      globalName: '__suite',
      target: 'es2022',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"development"' },
      plugins: [virtualFsPlugin(fileMap, { react: true, harness: DOM_HARNESS_MODULE })],
    })
    self.postMessage({ type: 'bundle', runId, code: result.outputFiles[0].text })
  } catch (error) {
    self.postMessage({ type: 'compile-error', runId, message: formatBuildError(error) })
  }
}

/**
 * Syntax-only check for the editor gutter.
 *
 * `transform`, not `build`: it parses one file and resolves no imports, so an
 * unfinished line reports as an unfinished line rather than as a missing module.
 * That distinction is the whole point — while you are typing, every import is
 * momentarily broken, and a linter that says so on every keystroke is noise.
 *
 * The loader is `tsx` regardless of the extension. A `.ts` file containing JSX
 * is a mistake the run will catch; a lint that refuses to parse it would flag
 * every line after the first tag, which teaches nothing.
 */
async function lint({ runId, code }) {
  const build = await boot()
  const diagnostics = []
  try {
    await build.transform(code, { loader: 'tsx', target: 'es2022' })
  } catch (error) {
    for (const problem of error?.errors ?? []) {
      diagnostics.push({
        line: problem.location?.line ?? 1,
        column: problem.location?.column ?? 0,
        message: problem.text ?? 'Syntax error',
      })
    }
    // esbuild throws with no `errors` array only when it failed for its own
    // reasons. Reporting that in the gutter would blame the candidate for it.
    if (diagnostics.length === 0) {
      self.postMessage({ type: 'lint-result', runId, diagnostics: [] })
      return
    }
  }
  self.postMessage({ type: 'lint-result', runId, diagnostics })
}

installConsoleCapture()

const HANDLERS = {
  run,
  'run-workspace': runWorkspace,
  bundle: bundleForFrame,
  lint,
}

self.onmessage = async (event) => {
  const request = event.data
  const handler = HANDLERS[request?.type]
  if (!handler) return
  try {
    await handler(request)
  } catch (error) {
    self.postMessage({
      type: 'fatal',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

boot().then(
  () => self.postMessage({ type: 'ready' }),
  (error) =>
    self.postMessage({
      type: 'fatal',
      message: `Failed to start the TypeScript runtime: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }),
)
