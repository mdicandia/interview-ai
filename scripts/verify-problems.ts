/**
 * Proves every bundled problem is internally consistent, in Node, without a browser.
 *
 * Algorithm problems:
 *   1. the reference solution passes every test case  — the test data is correct
 *   2. the starter code does NOT pass                 — the tests discriminate
 *
 * Workspace problems:
 *   1. the reference patch makes the whole suite green — the exercise is solvable
 *   2. the starter matches its declared `startingState`:
 *        'failing' — at least one test fails, or the "bug" isn't actually covered
 *        'passing' — all green, which is the premise of a refactor exercise
 *
 * Point 2 matters more than it looks in both cases. A suite that a `pass`-bodied
 * stub satisfies is not testing anything, and a bug squash whose bug no test
 * catches is just a reading exercise. Neither failure is visible by eye.
 *
 * Run with: pnpm verify:problems
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, transform } from 'esbuild-wasm'
import { matches } from '../lib/runtime/compare'
import {
  supportedLanguages,
  DISCUSSION_FORMAT_LABELS,
  type AlgorithmProblem,
  type DiscussionProblem,
  type Language,
  type Problem,
  type RapidFireSet,
  type WorkspaceProblem,
} from '../lib/problems/types'
import { PROBLEMS } from '../problems/index'
import { QUESTIONS } from '../questions/index'
import { RAPID_FIRE_SETS } from '../questions/canon/index'

const PYTHON = process.env.PYTHON_BIN ?? 'python3'
const RESULT_MARKER = '---RESULTS---'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

interface Outcome {
  name: string
  ok: boolean
  detail?: string
}

/* ------------------------------------------------------------------ algorithm */

function runPythonAlgorithm(problem: AlgorithmProblem, code: string): Outcome[] {
  const dir = mkdtempSync(join(tmpdir(), 'verify-'))
  const entry = problem.entryPoint.python ?? ''

  const script = `${code}

import json, sys, traceback

__cases = json.loads(${JSON.stringify(JSON.stringify(problem.tests.map((t) => t.args)))})
__out = []
for __args in __cases:
    try:
        __out.append({"ok": True, "value": ${entry}(*__args)})
    except Exception as exc:
        __out.append({"ok": False, "error": "".join(
            traceback.format_exception_only(type(exc), exc)).strip()})
sys.stdout.write(${JSON.stringify(RESULT_MARKER)} + json.dumps(__out, default=str))
`

  try {
    writeFileSync(join(dir, 'run.py'), script)
    const stdout = execFileSync(PYTHON, [join(dir, 'run.py')], {
      encoding: 'utf8',
      timeout: 20_000,
    })
    const raw = JSON.parse(stdout.slice(stdout.indexOf(RESULT_MARKER) + RESULT_MARKER.length)) as {
      ok: boolean
      value?: unknown
      error?: string
    }[]

    return problem.tests.map((test, i) => {
      const got = raw[i]
      if (!got?.ok) return { name: test.name, ok: false, detail: got?.error ?? 'no result' }
      const ok = matches(got.value, test.expected, problem.compare ?? 'deep-equal')
      return {
        name: test.name,
        ok,
        detail: ok
          ? undefined
          : `expected ${JSON.stringify(test.expected)}, got ${JSON.stringify(got.value)}`,
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return problem.tests.map((t) => ({ name: t.name, ok: false, detail: message }))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function runTsAlgorithm(problem: AlgorithmProblem, code: string): Promise<Outcome[]> {
  const entry = problem.entryPoint.typescript ?? ''
  let fn: (...args: unknown[]) => unknown
  try {
    const { code: js } = await transform(code, { loader: 'ts', target: 'es2022' })
    fn = new Function(`${js}\n;return ${entry};`)() as (...args: unknown[]) => unknown
    if (typeof fn !== 'function') throw new Error(`\`${entry}\` is not a function`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return problem.tests.map((t) => ({ name: t.name, ok: false, detail: message }))
  }

  return problem.tests.map((test) => {
    try {
      const actual = fn(...structuredClone(test.args))
      const ok = matches(actual, test.expected, problem.compare ?? 'deep-equal')
      return {
        name: test.name,
        ok,
        detail: ok
          ? undefined
          : `expected ${JSON.stringify(test.expected)}, got ${JSON.stringify(actual)}`,
      }
    } catch (error) {
      return {
        name: test.name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      }
    }
  })
}

/* ------------------------------------------------------------------ workspace */

type FileMap = Record<string, string>

/** Starter files with the reference patch applied on top. */
function withPatch(problem: WorkspaceProblem, language: Language, patched: boolean): FileMap {
  const files: FileMap = {}
  for (const file of problem.files[language] ?? []) files[file.path] = file.content
  if (patched) Object.assign(files, problem.referencePatch[language] ?? {})
  return files
}

function runPythonWorkspace(files: FileMap, testPath: string): Outcome[] {
  const dir = mkdtempSync(join(tmpdir(), 'verify-ws-'))
  try {
    for (const [path, content] of Object.entries(files)) {
      writeFileSync(join(dir, path), content)
    }

    const runner = `
import importlib, json, sys, traceback

sys.path.insert(0, ${JSON.stringify(dir)})
module = importlib.import_module(${JSON.stringify(testPath.replace(/\.py$/, ''))})

results = []
for name in sorted(n for n in dir(module)
                   if n.startswith("test_") and callable(getattr(module, n))):
    try:
        getattr(module, name)()
        results.append({"name": name, "ok": True})
    except BaseException as exc:
        results.append({"name": name, "ok": False, "error": "".join(
            traceback.format_exception_only(type(exc), exc)).strip()})

sys.stdout.write(${JSON.stringify(RESULT_MARKER)} + json.dumps(results))
`
    writeFileSync(join(dir, '__runner.py'), runner)
    const stdout = execFileSync(PYTHON, [join(dir, '__runner.py')], {
      encoding: 'utf8',
      timeout: 20_000,
    })
    const raw = JSON.parse(
      stdout.slice(stdout.indexOf(RESULT_MARKER) + RESULT_MARKER.length),
    ) as { name: string; ok: boolean; error?: string }[]
    return raw.map((r) => ({ name: r.name, ok: r.ok, detail: r.error }))
  } catch (error) {
    return [
      {
        name: '(suite failed to load)',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      },
    ]
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Mirrors the browser worker: esbuild with a plugin serving an in-memory file map,
 * plus the same virtual `harness` assertion module. Keeping these in step is what
 * makes this script a real proxy for what the candidate will see.
 */
const HARNESS_MODULE = `
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  return '{' + Object.keys(value).sort()
    .map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
}
export function equal(actual, expected, message) {
  if (!Object.is(actual, expected)) {
    throw new Error((message ? message + '\\n' : '') +
      'expected ' + JSON.stringify(expected) + ' but got ' + JSON.stringify(actual))
  }
}
export function deepEqual(actual, expected, message) {
  const a = canonical(actual), b = canonical(expected)
  if (a !== b) throw new Error((message ? message + '\\n' : '') + 'expected ' + b + ' but got ' + a)
}
export function ok(value, message) {
  if (!value) throw new Error(message || 'expected truthy, got ' + JSON.stringify(value))
}
export function throws(fn, message) {
  try { fn() } catch { return }
  throw new Error(message || 'expected the function to throw')
}
`

/**
 * Fails a test that never settles, instead of letting it end the whole run.
 *
 * A pending promise is not an error to Node: with nothing else outstanding the
 * event loop simply empties and the process exits **zero**. That is what happened
 * the first time an async problem was added here — one test awaited a promise
 * that could never resolve, and `verify:problems` reported success having quietly
 * skipped every problem after it. A green suite that ran a third of itself is
 * worse than a red one.
 *
 * The timer also keeps the loop alive, so the silent exit cannot recur even if
 * this races oddly.
 */
const TEST_TIMEOUT_MS = 10_000

async function withTimeout(work: unknown): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.resolve(work),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${TEST_TIMEOUT_MS}ms — a promise never settled`)),
          TEST_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function runTsWorkspace(files: FileMap, testPath: string): Promise<Outcome[]> {
  const fileMap = new Map(Object.entries(files))

  // Kept in step with resolveVirtual in public/workers/js.worker.js.
  const resolveVirtual = (specifier: string) => {
    const cleaned = specifier.replace(/^\.\//, '')
    for (const extension of ['', '.tsx', '.ts', '.jsx', '.js']) {
      if (fileMap.has(cleaned + extension)) return cleaned + extension
    }
    return null
  }

  let bundled: string
  try {
    const result = await build({
      entryPoints: [testPath],
      bundle: true,
      write: false,
      format: 'iife',
      globalName: '__suite',
      target: 'es2022',
      plugins: [
        {
          name: 'virtual-fs',
          setup(b) {
            b.onResolve({ filter: /.*/ }, (args) => {
              if (args.path === 'harness') return { path: 'harness', namespace: 'virtual' }
              const resolved = resolveVirtual(args.path)
              return resolved
                ? { path: resolved, namespace: 'virtual' }
                : { errors: [{ text: `Cannot resolve "${args.path}"` }] }
            })
            b.onLoad({ filter: /.*/, namespace: 'virtual' }, (args) => ({
              contents: args.path === 'harness' ? HARNESS_MODULE : fileMap.get(args.path),
              loader: 'ts' as const,
            }))
          },
        },
      ],
    })
    bundled = result.outputFiles[0].text
  } catch (error) {
    return [
      {
        name: '(bundle failed)',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      },
    ]
  }

  const suite = new Function(`${bundled}\n;return __suite;`)() as Record<string, () => unknown>
  const names = Object.keys(suite ?? {})
    .filter((k) => k.startsWith('test') && typeof suite[k] === 'function')
    .sort()

  const outcomes: Outcome[] = []
  for (const name of names) {
    try {
      await withTimeout(suite[name]())
      outcomes.push({ name, ok: true })
    } catch (error) {
      outcomes.push({
        name,
        ok: false,
        detail: error instanceof Error ? error.message.split('\n')[0] : String(error),
      })
    }
  }
  return outcomes
}

function runWorkspace(
  problem: WorkspaceProblem,
  language: Language,
  patched: boolean,
): Promise<Outcome[]> {
  const files = withPatch(problem, language, patched)
  const testPath = problem.testPath[language] ?? ''
  return language === 'python'
    ? Promise.resolve(runPythonWorkspace(files, testPath))
    : runTsWorkspace(files, testPath)
}

/* ----------------------------------------------------------------------- main */

let failures = 0

function report(ok: boolean, message: string, details: Outcome[] = []) {
  if (ok) {
    console.log(`  ${GREEN}✓${RESET} ${message}`)
    return
  }
  failures++
  console.log(`  ${RED}✗${RESET} ${message}`)
  for (const d of details) console.log(`      ${RED}${d.name}${RESET} — ${d.detail ?? ''}`)
}

async function verifyAlgorithm(problem: AlgorithmProblem) {
  for (const language of supportedLanguages(problem)) {
    const run = (code: string) =>
      language === 'python'
        ? Promise.resolve(runPythonAlgorithm(problem, code))
        : runTsAlgorithm(problem, code)

    const reference = await run(problem.referenceSolution[language] ?? '')
    const failed = reference.filter((r) => !r.ok)
    report(
      failed.length === 0,
      `${language}: reference passes ${reference.length - failed.length}/${reference.length}`,
      failed,
    )

    const starter = await run(problem.starterCode[language] ?? '')
    const passed = starter.filter((r) => r.ok).length
    report(
      passed < starter.length,
      passed < starter.length
        ? `${language}: starter fails as expected ${DIM}(${passed}/${starter.length} passing)${RESET}`
        : `${language}: starter passes every test — the cases don't discriminate`,
    )
  }
}

async function verifyWorkspace(problem: WorkspaceProblem) {
  // Frontend problems render React into a real DOM inside a sandboxed iframe.
  // Node has neither, and standing up a headless DOM here would verify a
  // *different* environment from the one the candidate uses — which is worse
  // than not verifying, because it would look like a guarantee. These are
  // checked by driving the actual browser instead.
  if (problem.variant === 'frontend') {
    console.log(`  ${DIM}- skipped: runs in a browser iframe, not in Node${RESET}`)
    return
  }

  for (const language of supportedLanguages(problem)) {
    const patched = await runWorkspace(problem, language, true)
    const patchFailed = patched.filter((r) => !r.ok)
    report(
      patched.length > 0 && patchFailed.length === 0,
      `${language}: reference patch passes ${patched.length - patchFailed.length}/${patched.length}`,
      patchFailed,
    )

    const starter = await runWorkspace(problem, language, false)
    const passing = starter.filter((r) => r.ok).length
    const total = starter.length

    if (problem.startingState === 'passing') {
      report(
        passing === total && total > 0,
        passing === total
          ? `${language}: starter is green as a refactor needs ${DIM}(${passing}/${total})${RESET}`
          : `${language}: refactor problem must start green, but ${total - passing} failed`,
        starter.filter((r) => !r.ok),
      )
    } else {
      report(
        passing < total,
        passing < total
          ? `${language}: starter fails as expected ${DIM}(${passing}/${total} passing)${RESET}`
          : `${language}: starter already passes everything — no bug is actually covered`,
      )
    }
  }
}

/* ---------------------------------------------------------------- discussion */

/**
 * Questions can't be executed, so verification is structural: it checks the bank
 * is well-formed enough for an interviewer to actually run and score.
 *
 * These rules exist because each failure is invisible by eye in a long file. A
 * question with no essential points can't distinguish a competent answer from a
 * rambling one; a code review with no code is unanswerable; a duplicated slug
 * silently shadows another question in the lookup map.
 */
function verifyQuestion(question: DiscussionProblem) {
  const essential = question.expectedPoints.filter((p) => p.essential)

  report(
    question.expectedPoints.length >= 4,
    question.expectedPoints.length >= 4
      ? `${question.expectedPoints.length} expected points ${DIM}(${essential.length} essential)${RESET}`
      : `only ${question.expectedPoints.length} expected points — too thin to score against`,
  )

  report(
    essential.length >= 2,
    essential.length >= 2
      ? 'has essential points to separate competent from incomplete'
      : `only ${essential.length} essential point(s) — nothing marks a floor for a good answer`,
  )

  report(
    question.hintLadder.length >= 3,
    question.hintLadder.length >= 3
      ? `${question.hintLadder.length} probes for a stalled candidate`
      : 'fewer than 3 probes — the interviewer has nothing to nudge with',
  )

  report(
    question.followUps.length >= 3,
    question.followUps.length >= 3
      ? `${question.followUps.length} follow-ups`
      : 'fewer than 3 follow-ups',
  )

  // A code review with nothing to read is not a code review.
  if (question.format === 'code-review') {
    const files = question.context ?? []
    report(
      files.length > 0 && files.every((f) => f.readOnly),
      files.length === 0
        ? 'code-review question has no context files to review'
        : files.every((f) => f.readOnly)
          ? `${files.length} read-only file(s) to review`
          : 'context files must all be read-only — this is a review, not an edit',
    )
  }

  report(
    question.expectedMinutes > 0 && question.expectedMinutes <= 45,
    `expects ~${question.expectedMinutes} min`,
  )
}

/* ---------------------------------------------------------------- rapid fire */

/**
 * A rapid-fire set is structural too, but the rules are the opposite shape.
 *
 * A discussion question is checked for *depth* — enough points, enough probes,
 * enough follow-ups. A drill question is checked for *brevity*: two or three
 * points, because sixty seconds cannot reach five, and a set with a
 * four-point question in it silently makes that question unpassable.
 *
 * The id check is the one that catches a real editing accident. Ids are how a
 * grading result finds its question, and duplicating one by copy-paste inside a
 * long file is invisible by eye and produces a summary that marks the wrong
 * answer.
 */
function verifyDrillSet(set: RapidFireSet) {
  report(
    set.questions.length >= 8,
    set.questions.length >= 8
      ? `${set.questions.length} questions`
      : `only ${set.questions.length} questions — a screen asks about ten`,
  )

  report(
    set.seconds >= 30 && set.seconds <= 120,
    `${set.seconds} seconds per question`,
  )

  const ids = set.questions.map((q) => q.id)
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i)
  report(
    duplicates.length === 0,
    duplicates.length === 0
      ? `${ids.length} unique question ids`
      : `duplicate question ids: ${[...new Set(duplicates)].join(', ')}`,
  )

  const thin = set.questions.filter((q) => q.expectedPoints.length < 2)
  report(
    thin.length === 0,
    thin.length === 0
      ? 'every question has at least 2 expected points'
      : `too few points on: ${thin.map((q) => q.id).join(', ')}`,
  )

  const fat = set.questions.filter((q) => q.expectedPoints.length > 3)
  report(
    fat.length === 0,
    fat.length === 0
      ? 'no question asks for more than 3 points in a minute'
      : `too many points for ${set.seconds}s on: ${fat.map((q) => q.id).join(', ')}`,
  )

  // A blank topic collapses the weak-topic summary into one unlabelled bucket,
  // which is the only part of the result that says what to do next.
  const untopiced = set.questions.filter((q) => q.topic.trim() === '')
  report(
    untopiced.length === 0,
    untopiced.length === 0
      ? `${new Set(set.questions.map((q) => q.topic)).size} topics covered`
      : `missing topic on: ${untopiced.map((q) => q.id).join(', ')}`,
  )

  const unasked = set.questions.filter((q) => q.prompt.trim() === '')
  report(unasked.length === 0, unasked.length === 0 ? 'every question has a prompt' : 'blank prompt')
}

function verifyUniqueSlugs() {
  const slugs = [
    ...PROBLEMS.map((p) => p.slug),
    ...QUESTIONS.map((q) => q.slug),
    ...RAPID_FIRE_SETS.map((s) => s.slug),
  ]
  const duplicates = slugs.filter((s, i) => slugs.indexOf(s) !== i)
  report(
    duplicates.length === 0,
    duplicates.length === 0
      ? `${slugs.length} unique slugs across problems, questions and drills`
      : `duplicate slugs: ${[...new Set(duplicates)].join(', ')}`,
  )
}

async function main() {
  for (const problem of PROBLEMS as Problem[]) {
    const tag = problem.kind === 'workspace' ? problem.variant : 'algorithm'
    console.log(`\n${problem.title} ${DIM}(${problem.slug} · ${tag})${RESET}`)
    if (problem.kind === 'workspace') await verifyWorkspace(problem)
    else await verifyAlgorithm(problem)
  }

  console.log(`\n${DIM}--- question bank (structural checks only) ---${RESET}`)
  for (const question of QUESTIONS) {
    console.log(
      `\n${question.title} ${DIM}(${question.slug} · ${DISCUSSION_FORMAT_LABELS[question.format]})${RESET}`,
    )
    verifyQuestion(question)
  }

  console.log(`\n${DIM}--- rapid-fire banks (structural checks only) ---${RESET}`)
  for (const set of RAPID_FIRE_SETS) {
    console.log(`\n${set.title} ${DIM}(${set.slug})${RESET}`)
    verifyDrillSet(set)
  }

  console.log('')
  verifyUniqueSlugs()

  const drillQuestions = RAPID_FIRE_SETS.reduce((sum, s) => sum + s.questions.length, 0)
  console.log(
    failures === 0
      ? `\n${GREEN}${PROBLEMS.length} problems verified in both runtimes; ` +
          `${QUESTIONS.length} questions and ${drillQuestions} rapid-fire questions ` +
          `structurally sound.${RESET}`
      : `\n${RED}${failures} check(s) failed.${RESET}`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

void main()
