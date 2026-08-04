/**
 * Python execution worker — real CPython compiled to WASM.
 *
 * This file is deliberately plain JavaScript served straight from /public rather
 * than a bundled TypeScript module. Turbopack rewrites any worker it compiles to
 * use its own chunk-loading runtime, and that runtime refuses to initialise
 * inside a worker ("Classic web workers are not supported"), which stops Pyodide
 * from ever loading. Keeping the file out of the build sidesteps that entirely
 * and lets `import` resolve against the real origin.
 *
 * The worker is a dumb executor: it runs code and reports raw return values.
 * Comparing them against expectations happens on the main thread, so there is one
 * comparison implementation shared by both languages instead of one per runtime.
 *
 * Protocol: see lib/runtime/protocol.ts
 */

const PYODIDE_URL = new URL('/pyodide/pyodide.mjs', self.location.origin).href
const PYODIDE_INDEX = new URL('/pyodide/', self.location.origin).href

let pyodide = null
let stdoutBuffer = []

async function boot() {
  if (pyodide) return pyodide

  const { loadPyodide } = await import(PYODIDE_URL)
  const instance = await loadPyodide({ indexURL: PYODIDE_INDEX })

  // Route Python's stdout/stderr into a buffer we can attribute to whichever case
  // is currently running, so `print()` debugging shows up beside its own test.
  instance.setStdout({ batched: (text) => stdoutBuffer.push(text) })
  instance.setStderr({ batched: (text) => stdoutBuffer.push(text) })

  // Defined once so each case is a cheap call rather than a re-parse.
  //
  // Errors are formatted here, in Python, rather than on the JS side. Pyodide
  // surfaces an exception as a JS Error whose message is the *whole* traceback,
  // including its own interpreter frames — a candidate with a one-line syntax
  // error would otherwise be shown a dozen frames of `CodeRunner` internals.
  // From inside Python we can keep only the frames belonging to their code.
  instance.runPython(`
import json, sys, traceback

__CANDIDATE_FILE = "<candidate>"
__SESSION_DIR = "/session"

def __harness_is_candidate_frame(filename):
    return filename == __CANDIDATE_FILE or filename.startswith(__SESSION_DIR)

def __harness_clean_error():
    """Format the in-flight exception, keeping only the candidate's own frames."""
    etype, exc, tb = sys.exc_info()
    frames = [f for f in traceback.extract_tb(tb) if __harness_is_candidate_frame(f.filename)]
    parts = []
    if frames:
        parts.append("Traceback (most recent call last):\\n")
        parts.extend(traceback.format_list(frames))
    # For a SyntaxError this already carries the file, line, and caret.
    parts.extend(traceback.format_exception_only(etype, exc))
    return "".join(parts).strip()

def __harness_define(source):
    """Compile and exec the candidate's code. Returns an error string, or None.

    Compiling under a fixed filename is what lets __harness_clean_error tell the
    candidate's frames apart from the interpreter's.
    """
    try:
        exec(compile(source, __CANDIDATE_FILE, "exec"), globals())
        return None
    except BaseException:
        return __harness_clean_error()

def __harness_call(fn, args_json):
    """Call fn with JSON-decoded args; JSON-encode the result or the error.

    Crossing the JS/Python boundary as JSON makes the conversion rules explicit
    and identical to the JavaScript runtime: a Python list and a JS array arrive
    on the main thread in the same shape, so one comparator serves both.
    """
    try:
        return json.dumps({"ok": True, "value": fn(*json.loads(args_json))}, default=str)
    except BaseException:
        return json.dumps({"ok": False, "error": __harness_clean_error()})

# ---------------------------------------------------------- workspace problems

def __harness_load_suite(module_name):
    """Import the test module fresh and report the test functions it defines.

    Every previously imported session module is dropped first. Without that, a
    second run would re-use the cached module objects and silently test the
    candidate's *old* code — the kind of bug that makes someone doubt their own
    fix rather than the tool.
    """
    import importlib

    stale = [
        name
        for name, mod in list(sys.modules.items())
        if getattr(mod, "__file__", None) and str(mod.__file__).startswith(__SESSION_DIR)
    ]
    for name in stale:
        del sys.modules[name]
    importlib.invalidate_caches()

    try:
        module = importlib.import_module(module_name)
    except BaseException:
        # An import-time failure (syntax error, bad import) means no test ran.
        return json.dumps({"ok": False, "error": __harness_clean_error()})

    names = sorted(
        n for n in dir(module)
        if n.startswith("test_") and callable(getattr(module, n))
    )
    return json.dumps({"ok": True, "tests": names})

def __harness_run_test(module_name, test_name):
    try:
        getattr(sys.modules[module_name], test_name)()
        return json.dumps({"ok": True})
    except BaseException:
        return json.dumps({"ok": False, "error": __harness_clean_error()})
`)

  // Session files live on a real (in-memory) filesystem so ordinary imports
  // between them work with no module shimming of any kind.
  instance.FS.mkdirTree('/session')
  instance.runPython(`
import sys
if "/session" not in sys.path:
    sys.path.insert(0, "/session")
`)

  pyodide = instance
  return instance
}

function drainStdout() {
  if (stdoutBuffer.length === 0) return undefined
  const text = stdoutBuffer.join('')
  stdoutBuffer = []
  return text.length > 0 ? text : undefined
}

/**
 * Pyodide surfaces Python exceptions as JS errors whose message is the full
 * formatted traceback. We keep it — a real traceback with line numbers is what
 * the candidate would see in a terminal — but drop the interpreter's own frames,
 * which are pure noise.
 */
function formatError(error) {
  const raw = error instanceof Error ? error.message : String(error)
  const lines = raw.split('\n')
  const filtered = lines.filter(
    (line) => !line.includes('/lib/python3') && !line.includes('pyodide.asm'),
  )
  return (filtered.length > 0 ? filtered : lines).join('\n').trim()
}

async function run({ runId, code, entryPoint, cases }) {
  const py = await boot()

  // Defining the candidate's code is a separate step from calling it: a syntax
  // error here means no case ever ran, which is a different conversation from
  // "your logic is wrong".
  stdoutBuffer = []
  py.globals.set('__harness_source', code)
  const defineError = py.runPython('__harness_define(__harness_source)')
  if (defineError) {
    self.postMessage({ type: 'compile-error', runId, message: String(defineError) })
    return
  }

  const isCallable = py.runPython(
    `callable(globals().get(${JSON.stringify(entryPoint)}))`,
  )
  if (!isCallable) {
    self.postMessage({
      type: 'compile-error',
      runId,
      message:
        `No callable named \`${entryPoint}\` was found.\n\n` +
        `Define a function called \`${entryPoint}\` at the top level of your solution.`,
    })
    return
  }

  for (let index = 0; index < cases.length; index++) {
    const started = performance.now()
    stdoutBuffer = []
    try {
      py.globals.set('__harness_args', JSON.stringify(cases[index]))
      const outcome = JSON.parse(py.runPython(`__harness_call(${entryPoint}, __harness_args)`))
      self.postMessage({
        type: 'case-result',
        runId,
        index,
        ...outcome,
        stdout: drainStdout(),
        durationMs: performance.now() - started,
      })
    } catch (error) {
      // Only reached if the harness itself failed (e.g. a value that won't
      // serialise), not for ordinary exceptions in the candidate's function.
      self.postMessage({
        type: 'case-result',
        runId,
        index,
        ok: false,
        error: formatError(error),
        stdout: drainStdout(),
        durationMs: performance.now() - started,
      })
    }
  }

  self.postMessage({ type: 'run-complete', runId })
}

/** Multi-file problems: write the files to disk, import the suite, run each test. */
async function runWorkspace({ runId, files, testPath }) {
  const py = await boot()

  // Clear the previous session so a renamed or deleted file can't linger and
  // keep satisfying an import.
  for (const name of py.FS.readdir('/session')) {
    if (name !== '.' && name !== '..') py.FS.unlink(`/session/${name}`)
  }
  for (const file of files) {
    py.FS.writeFile(`/session/${file.path}`, file.content)
  }

  const moduleName = testPath.replace(/\.py$/, '')

  stdoutBuffer = []
  const loaded = JSON.parse(py.runPython(`__harness_load_suite(${JSON.stringify(moduleName)})`))
  if (!loaded.ok) {
    self.postMessage({ type: 'compile-error', runId, message: loaded.error })
    return
  }
  if (loaded.tests.length === 0) {
    self.postMessage({
      type: 'compile-error',
      runId,
      message: `No tests found in ${testPath}.\n\nTest functions must be named \`test_*\` and defined at module level.`,
    })
    return
  }

  self.postMessage({ type: 'suite-start', runId, tests: loaded.tests })

  for (const name of loaded.tests) {
    const started = performance.now()
    stdoutBuffer = []
    const outcome = JSON.parse(
      py.runPython(`__harness_run_test(${JSON.stringify(moduleName)}, ${JSON.stringify(name)})`),
    )
    self.postMessage({
      type: 'test-outcome',
      runId,
      name,
      ok: outcome.ok,
      error: outcome.error,
      stdout: drainStdout(),
      durationMs: performance.now() - started,
    })
  }

  self.postMessage({ type: 'run-complete', runId })
}

self.onmessage = async (event) => {
  const request = event.data
  if (request?.type !== 'run' && request?.type !== 'run-workspace') return
  try {
    await (request.type === 'run' ? run(request) : runWorkspace(request))
  } catch (error) {
    self.postMessage({
      type: 'fatal',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

// Boot eagerly so the download overlaps with the candidate reading the problem.
boot().then(
  () => self.postMessage({ type: 'ready' }),
  (error) =>
    self.postMessage({
      type: 'fatal',
      message: `Failed to start the Python runtime: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }),
)
