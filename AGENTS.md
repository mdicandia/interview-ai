<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# interview-ai

A local, single-user tool for practising **live coding interviews**: a voice
interviewer talking to you while you write code in a shared editor. Build plan and
phase breakdown: `~/.claude/plans/can-we-develop-something-wobbly-lamport.md`.

Status: **editor + execution complete, for both problem kinds.**
No voice, no interviewer, no report yet — nothing in this repo calls an LLM.

## Three execution paths

| Path | Runs | Where |
|---|---|---|
| Pyodide worker | Python, incl. real `sqlite3` | `public/workers/pyodide.worker.js` |
| JS worker | TypeScript suites, and bundling | `public/workers/js.worker.js` |
| Sandboxed iframe | React, with a visible preview | `lib/runtime/frame.ts` |

The iframe path exists because **Web Workers have no DOM**. The worker bundles
(it owns the esbuild instance); the iframe renders and executes. React is
pre-bundled at install time into `public/vendor/react.js` — there is no
node_modules in the browser, and a CDN would break offline use.

## Constraints that are easy to re-break

**1. Execution workers must live in `public/workers/` as plain JS.**
They are deliberately *not* bundled TypeScript. Turbopack rewrites any worker it
compiles to use its own chunk-loading runtime, and that runtime refuses to start
inside a worker — it throws `Classic web workers are not supported`, and Pyodide
never loads. Keeping the files out of the build also lets `import` resolve against
the real origin. Consequence: the workers cannot import from `lib/`, which is why
they only *execute* and report raw values, while all comparison happens on the
main thread in `lib/runtime/client.ts`.

**2. Module resolution is duplicated in two places, on purpose.**
`resolveVirtual` and the `harness` assertion module exist in both
`public/workers/js.worker.js` and `scripts/verify-problems.ts`. The worker can't
import from `lib/` (constraint 1) and the verify script must not depend on a
browser. If you change one, change the other — otherwise `verify:problems` starts
certifying an environment the candidate never runs in.

**3. The DeepSeek system prompt + problem statement must be a byte-identical prefix.**
DeepSeek's context caching is automatic but matches only from token 0, and a cache
hit is ~50× cheaper than a miss. Never interpolate a timestamp, session id, or the
current editor contents into that prefix — volatile content goes *after* the
conversation history. (Not built yet.)

## Commands

```bash
pnpm dev               # UI on :3000
pnpm verify:problems   # reference solutions pass, starter code fails — both runtimes
pnpm typecheck
pnpm lint
pnpm copy-assets       # re-copy Pyodide/esbuild WASM into public/ (also runs postinstall)
```

## Layout

- `problems/*.ts` — problem definitions as typed modules (not JSON: statements and
  starter code are multi-line, and escaping that by hand is a bug farm).
  `referenceSolution` is stripped in `toClientProblem` and never reaches the browser.
- `questions/*.ts` — the non-coding question bank (`kind: 'discussion'`).
  **Deliberately not in `PROBLEMS` and not in the picker.** A verbal answer has no
  test suite, so nothing can grade one until the interviewer exists; wiring them
  into the UI now would ship a screen that shows a question and does nothing. The
  rubrics are the durable part and are verified structurally today.
- `lib/runtime/` — worker protocol, comparison, and the supervising client.
- `public/workers/` — the two execution workers. See constraint 1.
- `server/` — voice pipeline and interviewer orchestration (Phase 2+, empty for now).
