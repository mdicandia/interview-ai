<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# interview-ai

A local, single-user tool for practising **live coding interviews**: a voice
interviewer talking to you while you write code in a shared editor. Build plan and
phase breakdown: `~/.claude/plans/can-we-develop-something-wobbly-lamport.md`.

Status: **editor, execution, voice interviewer with tool use, hints, backchannel
clips, spoken rounds with a coverage grader, and the post-session report all
work.** Still missing: editor linting, and automatic socket reconnection — a
dropped connection is recovered by pressing Start again, which resumes from the
saved transcript rather than reconnecting on its own.

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
conversation history. See `server/interview/prompt.ts`.

**4. Capture and playback run at different sample rates, on purpose.**
`AUDIO_SAMPLE_RATE` is 16kHz (browser → server, what Deepgram wants).
`PLAYBACK_SAMPLE_RATE` is 24kHz (server → browser, what Kokoro produces
natively). Every resample is quality lost or filter code to get wrong, so each
direction runs at its own master's rate and nothing converts. The capture worklet
resamples from whatever the AudioContext is at down to 16kHz by itself, so it
follows automatically — but `CAPACITY` in `public/worklets/playback.worklet.js`
is hard-coded to two seconds at 24kHz and cannot import the constant.

**5. A TTS context id is good for exactly one turn.**
`tts.finish()` sends `continue: false`, which closes the context at Cartesia
permanently. Reusing the id on the next turn is rejected with "Context has closed
and is no longer accepting new inputs" — and it fails silently in the worst way:
the transcript keeps streaming, so the interviewer looks like it is talking while
no audio comes out. `#respond` increments the counter on every turn, not only on
barge-in.

**6. The report's evidence is accumulated in the browser, not the voice server.**
`InterviewSession` holds the transcript, but *only* that — the code, the test runs,
the hints and the timings live on the client, and the voice server may never have
been connected at all. A round worked through in silence is a normal way to
practise, and a server-built report would produce nothing for it. So the browser
appends to `lib/session/record.ts` as things happen and POSTs the record to
`/api/report`, which re-loads the problems server-side. That route is the only
place reference solutions, reference patches and `expectedPoints` are ever read —
they are what let the report judge code rather than describe it, and they still
reach no served file. There is deliberately no `report` message on the socket.

**7. Every tool added to the interviewer makes the others fire less.**
They compete with speaking for the model's attention. Measured: with `run_tests`
listed first it fired on 4 turns of 5 while `note_observation` fired on 0. So
scoring a spoken round is *not* a tool — a second DeepSeek call reads the whole
transcript and owns the tally (`server/interview/grader.ts`), off the latency
path, and the interviewer is simply told the result in the volatile note. Two
things follow. It can revise, where a fire-and-forget tick never could. And
because coverage is *derived from the transcript* rather than accumulated in
memory, resume is free: the browser sends back what was said, the server rebuilds
`#history` and recomputes the tally, and nothing about a session needs persisting
server-side. Anything you are tempted to add as a fourth tool should be weighed
against this.

## Commands

```bash
pnpm dev               # UI on :3000
pnpm test              # everything free and deterministic, ~8s. Run this.
pnpm copy-assets       # re-copy Pyodide/esbuild WASM into public/ (also runs postinstall)
pnpm gen:backchannels  # re-synthesise the "mm-hm" clips — required after changing the voice
```

`pnpm test` chains `typecheck`, `lint`, and the four checks that need no API key:

```bash
pnpm verify:session    # storage: outcomes, what a checkpoint freezes, drafts, the clock
pnpm verify:tools      # tool dispatch, resume, the tally note — stubbed model, no network
pnpm verify:problems   # reference solutions pass, starter code fails — both runtimes
pnpm verify:grader     # its machinery half; SKIP_LIVE=1 leaves out the model call
```

The rest cost money and are run deliberately, not on every change:

```bash
pnpm verify:grader     # without SKIP_LIVE: coverage marks substance, not fluency
pnpm verify:report     # the report separates content from delivery, and cites real quotes
pnpm verify:server     # a real spoken session: turn machine, tool use, barge-in
pnpm verify:voice      # the raw pipeline against Deepgram, Cartesia and DeepSeek
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
- `lib/session/` — session templates and the timer (`store.ts`), plus the evidence
  record the report is built from (`record.ts`). See constraint 6. Every rule
  about *time* here — what a checkpoint freezes, what it refreshes — was written
  in response to a specific wrong duration on the history page, so change it
  against `verify:session` rather than by reasoning.
- `server/pipeline/` — STT, the sentence splitter, the `LLMProvider`, and two
  text-to-speech implementations behind one interface (`voice.ts` picks). The
  default is local: Kokoro, an 82M Apache-2.0 model on the CPU, no key and no
  per-character cost. Measured on this machine: fp32 reaches first audio in
  ~550ms and runs at 4x realtime — and fp32 is *twice as fast as q8*, because
  int8 has no accelerated kernel here.
- `server/backchannel/` — committed "mm-hm" clips that cover the gap while the
  model thinks. Measured: median gap after the candidate stops talking drops from
  ~1.5s to ~490ms. They are the same speaker as the interviewer, so regenerate
  them whenever the voice changes.
- `server/interview/` — the frozen-prefix prompt builder, the turn state machine,
  the hint ladder, the coverage grader (see constraint 7), and `report.ts`.
