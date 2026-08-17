/**
 * Proves the answer keys are not in anything the browser can download.
 *
 * The whole design of this tool leans on one claim: reference solutions,
 * reference patches, expected answer points and hint ladders exist server-side
 * only. They are what let the report judge code rather than describe it, and
 * what let the interviewer tell "hasn't said it yet" from "doesn't know it" —
 * and every one of them is the answer to the exercise. `toClientProblem` and
 * `toClientQuestion` strip them, `/api/report`, `/api/hint` and `/api/solution`
 * are the only readers.
 *
 * That claim was verified once, by hand, by reading imports. This checks it
 * against the built output instead, because the failure mode is not a bad import
 * — it is an innocent one. A component that imports `PROBLEMS` instead of the
 * client catalogue for a title, and the bundler quietly ships every solution in
 * the app to anyone who opens the network tab. Nothing errors. Nothing looks
 * wrong. The exercise is just silently pointless from then on.
 *
 * Three things are scanned, and the third is the one that matters most.
 * `.next/static` holds the JavaScript chunks. But the question and problem pages
 * are prerendered, so their HTML and their React payloads (`.rsc`) are shipped
 * verbatim too — and *that* is where a leak would actually land, because passing
 * the full problem to a client component serialises the answer key straight into
 * the props. Scanning only the chunks would have missed the likeliest failure.
 *
 * The compiled server chunks under `.next/server` are deliberately excluded:
 * they are supposed to contain the keys, since that is where they are read.
 *
 * Run with: pnpm verify:bundle (after `pnpm build`)
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PROBLEMS } from '../problems'
import { QUESTIONS } from '../questions'
import { RAPID_FIRE_SETS } from '../questions/canon'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

let failures = 0
function check(ok: boolean, label: string, detail = '') {
  if (ok) console.log(`  ${GREEN}✓${RESET} ${label}${detail ? ` ${DIM}${detail}${RESET}` : ''}`)
  else {
    failures += 1
    console.log(`  ${RED}✗${RESET} ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** One thing that must not be downloadable, and where it came from. */
interface Secret {
  source: string
  kind: string
  needle: string
}

/**
 * A distinctive run of words from the middle of the text.
 *
 * Not the whole thing: bundlers re-indent, re-quote and escape, so a long exact
 * match produces false *passes*. A short one produces false failures — "return
 * None" appears in half the starter code. Twelve words from the middle of a
 * sentence is specific enough to be unique and short enough to survive
 * reformatting.
 */
function needle(text: string): string | null {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  if (words.length < 12) return null
  const start = Math.floor(words.length / 3)
  return words.slice(start, start + 12).join(' ')
}

/**
 * Everything the candidate is legitimately handed for this problem.
 *
 * A reference patch is a *fixed version of the starter code*, so most of its
 * text is text they already have on screen. A needle taken from a shared line
 * matches the served page and reports a leak that is really the exercise working
 * as intended — the first run of this check flagged three that way. Matching the
 * needle against this first keeps the check honest.
 */
function alreadyGiven(problem: (typeof PROBLEMS)[number]): string {
  const parts = [problem.statement]
  if (problem.kind === 'workspace') {
    for (const files of Object.values(problem.files)) {
      for (const file of files ?? []) parts.push(file.content)
    }
  } else if (problem.kind === 'algorithm') {
    parts.push(...Object.values(problem.starterCode))
  }
  return parts.join(' ').replace(/\s+/g, ' ')
}

function collectSecrets(): Secret[] {
  const secrets: Secret[] = []

  for (const problem of PROBLEMS) {
    const given = alreadyGiven(problem)
    const isNew = (n: string | null) => (n !== null && !given.includes(n) ? n : null)
    for (const hint of problem.hintLadder) {
      const n = needle(hint)
      if (n) secrets.push({ source: problem.slug, kind: 'hint', needle: n })
    }
    if (problem.kind === 'algorithm') {
      for (const [language, solution] of Object.entries(problem.referenceSolution)) {
        const n = isNew(needle(solution))
        if (n) secrets.push({ source: `${problem.slug} (${language})`, kind: 'reference solution', needle: n })
      }
    } else if (problem.kind === 'workspace') {
      for (const [language, patch] of Object.entries(problem.referencePatch)) {
        for (const content of Object.values(patch ?? {})) {
          const n = isNew(needle(content))
          if (n) secrets.push({ source: `${problem.slug} (${language})`, kind: 'reference patch', needle: n })
        }
      }
    }
  }

  for (const question of QUESTIONS) {
    for (const point of question.expectedPoints) {
      const n = needle(point.point)
      if (n) secrets.push({ source: question.slug, kind: 'expected point', needle: n })
    }
    for (const probe of question.hintLadder) {
      const n = needle(probe)
      if (n) secrets.push({ source: question.slug, kind: 'probe', needle: n })
    }
  }

  /*
   * The drill banks, where a leak would matter most.
   *
   * A discussion round runs twenty minutes and its answer key still leaves you
   * having to say the thing convincingly. A rapid-fire question is sixty seconds
   * and its key is two or three sentences that answer it outright — so if any
   * bank's points ever reach a served file, reading them from the network tab
   * is the whole exercise.
   */
  for (const set of RAPID_FIRE_SETS) {
    for (const question of set.questions) {
      for (const point of question.expectedPoints) {
        const n = needle(point)
        if (n) secrets.push({ source: `${set.slug}/${question.id}`, kind: 'drill point', needle: n })
      }
    }
  }

  return secrets
}

function everyFileUnder(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...everyFileUnder(path))
    else found.push(path)
  }
  return found
}

function main() {
  const staticDir = join(process.cwd(), '.next', 'static')
  if (!existsSync(staticDir)) {
    console.error(
      `\n${RED}No .next/static — build first.${RESET}\n  ${DIM}pnpm build && pnpm verify:bundle${RESET}\n`,
    )
    process.exit(1)
  }

  const secrets = collectSecrets()
  const appDir = join(process.cwd(), '.next', 'server', 'app')
  const files = [
    ...everyFileUnder(staticDir).filter((path) => /\.(js|json|txt|css)$/.test(path)),
    // Prerendered output. Served as-is to the browser, unlike the .js beside it.
    ...(existsSync(appDir) ? everyFileUnder(appDir).filter((path) => /\.(html|rsc)$/.test(path)) : []),
  ]

  console.log(`\nScanning ${files.length} served files for ${secrets.length} answer keys`)

  // One pass over each file, matched against every needle. The other way round
  // re-reads a 2MB chunk once per secret.
  const leaks: { secret: Secret; file: string }[] = []
  for (const file of files) {
    const contents = readFileSync(file, 'utf8').replace(/\s+/g, ' ')
    for (const secret of secrets) {
      if (contents.includes(secret.needle)) leaks.push({ secret, file })
    }
  }

  check(secrets.length > 20, 'found answer keys to look for', `${secrets.length} strings`)
  check(files.length > 0, 'found served files to look in', `${files.length} files`)
  check(
    leaks.length === 0,
    'no answer key appears in anything the browser downloads',
    leaks
      .slice(0, 5)
      .map((leak) => `${leak.secret.kind} from ${leak.secret.source} in ${leak.file.replace(`${process.cwd()}/.next/`, '')}`)
      .join('; '),
  )

  if (leaks.length > 0) {
    console.error(
      `\n${RED}${leaks.length} leak(s).${RESET} Something imported the full problem or question` +
        ` module into a client component. Use toClientProblem/toClientQuestion, or move the read` +
        ` behind an API route.\n`,
    )
  }

  console.log(
    failures === 0
      ? `\n${GREEN}The answer keys stay on the server.${RESET}\n`
      : `\n${RED}${failures} check(s) failed.${RESET}\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main()
