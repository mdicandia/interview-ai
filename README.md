# interview-ai

A local, single-user tool for practising **live coding interviews**: a voice
interviewer talks to you while you write code in a shared editor, then a report
afterwards tells you whether the thing holding you back was the knowledge or the
English.

Everything runs on this machine. Code executes in the browser — Pyodide for
Python, an esbuild-powered worker for TypeScript, a sandboxed iframe for React —
and the interviewer's voice is a local 82M model, so an idle session costs
nothing and there is no meter running.

There are three ways to practise, because real loops have three shapes: a coding
round with an interviewer watching you type, a spoken question explored for
twenty minutes, and a **rapid-fire drill** — ten questions at sixty seconds each
with no follow-ups, which is what a screen actually does and which trains recall
under pressure rather than reasoning.

## Running it

```bash
pnpm install
pnpm dev     # UI on :3000, voice server on :8787
```

Speech needs two keys in `.env.local` — see `.env.example`. Without them the
editor, the runtimes and the reports all still work; only the talking does not.

```bash
pnpm test    # everything free and deterministic, ~8s
```

## Where the real documentation is

**[`AGENTS.md`](AGENTS.md)** — the architecture, and more importantly the eight
constraints that are easy to re-break by accident. Read it before changing
anything: several of them look like arbitrary choices and are not.

- **[`BACKLOG.md`](BACKLOG.md)** — what to build next, ranked by what has actually
  cost an interview rather than by effort.
- **[`PLAN.md`](PLAN.md)** — how that backlog gets built, in dependency order.

## Layout, briefly

| Path | What lives there |
|---|---|
| `problems/` | Coding problems as typed modules. Answer keys never reach the browser. |
| `questions/` | The spoken question bank — concepts, trade-offs, code review, system design, behavioural. |
| `questions/canon/` | The rapid-fire banks: ~77 sixty-second questions, transcribed from real screens. |
| `lib/runtime/` | The worker protocol and the client that supervises execution. |
| `public/workers/` | The two execution workers. Plain JS on purpose — see constraint 1. |
| `lib/session/` | Session state, the clock, drafts, history, and the evidence record. |
| `server/pipeline/` | Speech to text, text to speech, and the language model behind one interface. |
| `server/interview/` | The prompt builder, the turn state machine, the coverage grader, the report. |
| `server/interview/drill.ts` | The rapid-fire driver: a timer and a speech queue, with no model in the loop. |
