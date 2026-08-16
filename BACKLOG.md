# Backlog — improvements ranked by "will this help me land a job"

Written after a read-through of the codebase in August 2026, against five real
interview processes and their outcomes. The ordering is not by effort or elegance;
it is by how directly each item attacks something that has actually cost a role.

## Context: what the rejections were

| Process | Outcome | Cause |
|---|---|---|
| OMNESOFT | Rejected after screen | C# fundamentals, asked rapid-fire: linked list/queue, interface vs abstract class, why multiple interfaces but single inheritance, DI, Task vs Thread |
| NextDay AI | Rejected after screen | JS fundamentals: event loop "not fully formed", functional programming/immutability "surface-level" |
| Silver.dev client | Passed agency screen, not selected | Feedback: English good, **improve storytelling** |
| Zipdev | Rejected | Rails required, none held |
| RYZ Labs | Went cold | Async assessment left unopened |

**Nothing was lost on coding ability.** Two were lost on verbal recall of
fundamentals, one on narrative structure. The app currently practises neither.

---

## P0 — attacks a named cause of rejection

### 1. Behavioral mode (`kind: 'behavioral'`)

The one weakness a recruiter named out loud, and the one with prepared material
already written (`~/Documents/Resumes/Behavioral-Answers.md`, ten answers).

Architecturally this is close to free: voice, STT, transcript and a grader that
scores against `expectedPoints` all exist. What differs is the rubric — and
crucially, most of it is **mechanically measurable**, which makes it more reliable
than a model judging vibes:

- **Agency ratio** — count first-person singular vs plural in the candidate's
  transcript. "We built" where "I built" belongs is the single most-cited defect
  in this candidate's answers. A raw ratio per answer, trended over sessions, is
  worth more than any prose feedback.
- **Length** — seconds spoken, against a 60–90s target. Currently over-long
  answers are invisible until an interviewer glazes over.
- **Has an ending** — does the last sentence contain an outcome (a number, a
  shipped thing, a permanent change), or does it trail off on a document, a
  process, or a feeling? Silver's phrase for the failure: *estirar historias sin
  final*.
- **Victim / excuse framing** — model-judged, small rubric: blame directed
  outward, self-deprecation, asking for sympathy.
- **Filler and hedging** — "genuinely", "basically", "kind of", "I think maybe".

Question set to seed it (the standard canon, all with prepared answers):
tell me about yourself · why this position · what have you been working on ·
demonstrate [value] · disagreement with leadership · underperforming peer ·
hardest technical challenge · a project that failed · questions for us · superpower.

Report should show the same content/delivery split already used for coding
rounds — for a second-language candidate that distinction is the whole point.

### 2. Rapid-fire fundamentals mode

The format that caused two rejections, and the one the app has no analogue for.

The existing `discussion` bank is 9 questions at ~20 minutes each — deep,
well-written, and testing a different muscle entirely. What screens actually do is
**ten questions at 60 seconds each with no thinking time**. Recall under time
pressure is a separate skill from reasoning, and it is trainable.

Mechanics: question spoken → 60s to answer → next, no back-and-forth. Score per
question against 2–3 expected points, then a summary of which topics were weak.

The bank already exists in prose form at
`~/Documents/Resumes/Interview-Canon.md` — roughly 70 questions across general
programming, JavaScript, TypeScript, Python, C#/.NET, React and databases, each
with a compact answer that can become `expectedPoints` directly. Also
`Technical-QA-Bank.md` (every question actually asked in a real screen, with the
answer that should have been given) and `React-QA-Bank.md`.

Highest-value subsets, in order: **JavaScript** (event loop, closures, `this`,
hoisting, FP/immutability, promises/microtasks) · **C#/.NET** (DI lifetimes,
interface vs abstract, Task vs Thread, value vs reference, LINQ laziness,
middleware) · **React** (keys, useEffect deps and cleanup, memoization trio,
Context vs state manager, server vs client state) · **databases** (index
mechanics, joins, N+1, ACID, WHERE vs HAVING).

### 3. C#/.NET question coverage

Two of five processes were .NET roles; the app cannot practise them at all.

Not a request for a C# runtime — execution can stay Python/TS/React. This is
purely `questions/`: DI and lifetimes, middleware pipeline, `Task` vs `Thread`,
`async`/`await` and why never `.Result` in ASP.NET, value vs reference types,
LINQ deferred execution, interface vs abstract class and the diamond problem,
layered architecture (controller → service → repository) and when Repository over
EF Core is redundant.

---

## P1 — makes each session produce a number that can move

### 4. Delivery telemetry

The report separates content from delivery, which is the right axis. But it is
model-judged prose, and several components are countable — countable feedback is
what changes behaviour:

- **Talk-time ratio while coding.** Silver's live-coding guidance is explicit that
  solving in silence can produce a "no". Currently unmeasured.
- **Longest silence** during a round, and where it fell.
- **Spoken WPM** — pace is a known lever for non-native speakers under nerves;
  deliberately slowing down reads as more fluent *and* more senior.
- **Filler rate** per minute.
- **Time-to-first-word** after the problem appears.

### 5. Typing telemetry

Measured externally at ~29 WPM on code against 50+ on prose. The bottleneck is
symbols and two competing keyboard layouts (Mac LatAm vs US Keychron), not
technique. The editor is right here:

- Effective WPM during a round (keystrokes, excluding paste).
- **Backspace ratio** — the accuracy signal that matters more than raw speed.
- Time spent on lines dense in `{} [] () => : _ | \` versus prose-like lines.

A per-session number, trended, converts "I should type faster" into something with
a slope.

### 6. Process markers

Cheap to compute from data already collected, and they are the habits interviewers
score rather than the answers:

- Did the problem get **restated** before code was written?
- Was a **clarifying question** asked in the first two minutes?
- **Time-to-first-test-run** — testing constantly is the single most-cited
  live-coding rule and the most commonly skipped.
- Was **complexity stated out loud** before being asked?
- Was a **plan narrated** before typing?

Surface them as a checklist in the report — pass/fail per round, trended across
sessions.

---

## P2 — makes practice compound

### 7. Weakness ledger with spaced repetition

`lib/session/history.ts` records what happened; nothing yet re-serves what was
missed. The value of 40 sessions comes from the misses returning.

Track `expectedPoints` that went uncovered and `run_tests` failures by topic, then
weight problem and question selection toward them. Surface "missed three times:
event loop, cache invalidation, N+1" on the home screen. A point answered
correctly twice in a row retires from rotation.

### 8. Pre-interview drill

There are real interviews booked. The mode that would actually get opened the
morning of one: give it a role — "Node/TypeScript, logistics domain" or ".NET +
agentic AI" — and it assembles a 20-minute warm-up from the relevant bank:
three rapid-fire fundamentals, one behavioral, one short coding round.

Seeded from the two live processes:
- **Cross-border logistics (Node/TS/React)** — idempotent charge, webhook ledger,
  rate limiter, order pricing, queue vs direct, plus multi-currency/tax
  calculation and carrier rate shopping, which are literally the domain.
- **Agentic AI full-stack** — the two AI questions, embedding search, plus tool
  design for an agent, streaming LLM UI, and when an agent beats a deterministic
  pipeline.

---

## P3 — realism

### 9. Cold open, and the clock

Real screens open with a couple of minutes of conversation before the problem
appears; the transition from small talk to technical is itself a thing to
rehearse. And nobody announces "five minutes left" — but a practice tool should,
because running out of time is a trainable failure.

### 10. Self-view

Especially for behavioral. Practising eye contact with the camera, and watching
one recording back in full, is the highest-yield and least pleasant intervention
available. The video never has to leave the machine.

---

## Housekeeping

- `README.md` is still the stock `create-next-app` text while `AGENTS.md` carries
  all the real documentation. Anyone landing on the repo reads the wrong file.
- `questions/index.ts` says the bank "cannot be practised yet… out of the picker",
  while `AGENTS.md` says questions *are* in the picker and playable. One of them
  is stale — and `AGENTS.md` itself warns that this exact drift happened before.

---

## What not to change

Worth stating, since a backlog reads like a list of faults:

- The **grader as a separate model call** rather than a fourth tool. The reasoning
  (tools compete for attention; a separate pass can revise; resume falls out free)
  is sound and hard-won.
- **Evidence accumulated in the browser**, so a silent round still produces a
  report.
- **`verify:bundle`** grepping prerendered HTML and RSC payloads for leaked answer
  keys. Most projects would have shipped the hint ladder forever.
- **Practical problems ordered before algorithms.** This matches the loops actually
  being interviewed for, not the ones on YouTube.
- **Local Kokoro TTS by default.** No key, no per-character cost, no reason for a
  practice tool to have a meter running.
