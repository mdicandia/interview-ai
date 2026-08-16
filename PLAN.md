# Implementation plan for BACKLOG.md

Written 2026-08-16, against the backlog in `BACKLOG.md`. That document ranks by
*what has cost a role*; this one sequences by dependency and risk, and says where
the two disagree.

Read `AGENTS.md` first — several items below are constrained by things recorded
there, particularly the frozen-prefix rule (constraint 3) and the "every tool
added makes the others fire less" measurement (constraint 7).

## What was checked before writing this

- **The source material exists.** `~/Documents/Resumes/` holds
  `Behavioral-Answers.md` (16KB), `Interview-Canon.md` (30KB),
  `Technical-QA-Bank.md` (12KB) and `React-QA-Bank.md` (8KB). Items 1, 2 and 3
  are therefore *transcription into a typed bank*, not authoring. That is the
  single biggest fact in this plan: it moves three P0 items from "write content"
  to "convert content", which is perhaps a third of the effort and far less
  judgement.
- **Both housekeeping items are real.** `README.md` is still stock
  `create-next-app`, and the doc comment at `questions/index.ts:7` still says the
  bank is "out of the picker" and "cannot be practised yet". Both are now false.
- **Two metrics have prerequisites the backlog does not mention.** See
  "Prerequisites discovered" below. They change what Phase 1 has to do first.

## The one structural insight

Nine of the metrics named across items 1 and 4 — agency ratio, answer length,
filler rate, hedging, spoken WPM, talk-time ratio, longest silence,
time-to-first-word, has-an-ending — are all functions of **one input**: the
timestamped transcript, which `lib/session/record.ts` already stores as
`TranscriptLine { role, text, at }`.

So they are not nine features. They are one pure module with nine exported
functions, no I/O, no model call, and no React — testable entirely offline in the
style of `scripts/verify-session.ts`, in milliseconds.

Build that first. It is the substrate for the highest-ranked item (behavioral)
*and* for all of item 4, and until it exists both of those are prose-judged
guesses.

## Prerequisites discovered

Two of the promised metrics cannot be computed from what is currently captured.
Both are small fixes, but they must land inside Phase 1 or the metrics built on
them will silently measure the wrong thing.

**1. The transcript has no speech timings.** `server/pipeline/stt.ts:47` declares
`onFinal: (text: string) => void` — text only. The `at` recorded against each
line is *when the server received the transcript*, which includes Deepgram's
model latency and its endpointing window. Deriving WPM or "longest silence" from
it measures the network as much as the speaker. Deepgram returns `start` and
`duration` on every result, and per-word timings when asked; the client throws
them away. Fix: widen `onFinal` to carry `{ text, start, duration }`, thread it
through `protocol.ts` and `record.ts`, and treat old records without it as
unmeasurable rather than guessing.

**2. Filler words are being deleted before we see them.** `stt.ts:94` sets
`smart_format: 'true'`, and Deepgram's formatter strips disfluencies. A filler
rate computed today would measure Deepgram's cleanup policy, not the candidate.
Fix: add `filler_words: 'true'` and verify against a recording that says "um"
deliberately. **If the two settings conflict, filler rate is the one to drop** —
smart formatting is what makes the transcript readable in the report, and a
readable transcript is worth more than one more countable metric.

## Phases

### Phase 0 — housekeeping (30 minutes)

Do it first because both items actively mislead a reader, and one of them misled
a reviewer this week.

- Replace `README.md` with something that says what the project is and points at
  `AGENTS.md`.
- Fix the stale doc comment at `questions/index.ts:7`.

*Verification:* none needed beyond reading it.

### Phase 1 — the speech-metrics substrate

**New:** `lib/session/speech.ts` — pure functions over `TranscriptLine[]`.

| Function | Mechanism | Reliability |
|---|---|---|
| `agencyRatio` | first-person singular vs plural in candidate lines | high — pure counting |
| `answerSeconds` | from speech timings | high, **after** prerequisite 1 |
| `wordsPerMinute` | words ÷ speaking time | high, after prerequisite 1 |
| `talkTimeRatio` | candidate speech ÷ round duration | high |
| `longestSilence` | largest gap between candidate lines, with its timestamp | medium — endpointing blurs edges |
| `timeToFirstWord` | first candidate line − round start | high |
| `hedgeRate` | matches against a fixed phrase list | high |
| `fillerRate` | same | **blocked on prerequisite 2** |

Also in this phase: the STT and record changes from the prerequisites.

*Verification:* extend `scripts/verify-session.ts`. Scripted transcripts with
known answers — a monologue that says "we" eight times and "I" once must report
an agency ratio that says so; a transcript with a deliberate two-minute gap must
find it. All offline, all in `pnpm test`.

*Risk:* the agency ratio is the metric the backlog cares most about and the one
most likely to be crude. "We migrated the database" and "we were told to migrate"
are the same to a counter and opposite to an interviewer. Ship the raw count
first, look at real numbers for a few sessions, and only then decide whether it
needs a model pass. Do not build the clever version first.

### Phase 2 — behavioral mode (item 1)

**Not a new `kind`.** `Problem` is `AlgorithmProblem | WorkspaceProblem` and
`DiscussionProblem` is deliberately outside it because a question has no test
suite. A behavioral question is a discussion question with a different rubric —
so add `format: 'behavioral'` to `DiscussionFormat` and it inherits the room, the
voice pipeline, the coverage grader, the record and the report for free.

- `questions/behavioral.ts` — the ten canonical questions, `expectedPoints`
  converted from `Behavioral-Answers.md`.
- `DISCUSSION_RUBRIC.behavioral` — a STAR-shaped content axis; delivery reuses
  `SPOKEN_DELIVERY`.
- The report gains a mechanical block per behavioral round, from Phase 1: agency
  ratio, length against a 60–90s target, and whether the answer ended on an
  outcome. Model-judged separately: victim/excuse framing.
- The interviewer's prompt for this format must *not* probe like a technical
  round — a behavioral interviewer asks one follow-up and then moves on.

*Verification:* add a behavioral round to `scripts/verify-report.ts` with a
transcript written to fail on purpose — all "we", no ending, three minutes long —
and assert the report names all three. That is the same shape as the existing
"halting English must score the same as fluent English" check, which is the one
assertion in this repo that has caught a real regression.

### Phase 3 — rapid-fire fundamentals, and the C#/.NET bank (items 2 and 3)

Merged, because item 3's content lands naturally in item 2's format.

**The important simplification: rapid-fire needs no LLM in the loop.** Ten
questions at 60 seconds with no back-and-forth means: speak the question, listen,
move on. No turn state machine, no tools, no nudges, no barge-in. The
conversational orchestrator is the wrong instrument. Grade *afterwards* in one
batched call over all ten answers — cheap, off the latency path, and it reuses
`CoverageGrader` almost unchanged.

- `lib/problems/types.ts` — a `RapidFireSet` type: a list of prompts each with
  2–3 `expectedPoints`.
- `questions/canon/*.ts` — converted from `Interview-Canon.md`,
  `Technical-QA-Bank.md`, `React-QA-Bank.md`. Order by the backlog's own ranking:
  JavaScript, then C#/.NET, then React, then databases.
- `server/interview/rapidfire.ts` — a driver that is a timer and a TTS queue.
- A room that shows the question, a countdown, and nothing else.
- A summary screen: which topics were weak, not just a score.

*Verification:* `verify:problems` gains a structural pass over the rapid-fire
bank (every question has expected points, no duplicate slugs). The batched grader
gets the same treatment as `verify:grader` — scripted answers with known-correct
coverage.

*Risk:* 70 questions is a lot of typed content and the temptation will be to
generate it. Don't. The value is that these are the questions actually asked, with
the answers that should have been given; a model rewriting them loses exactly
that.

### Phase 4 — telemetry into the report (items 4, 5, 6)

Phase 1 already computes the speech half. This phase adds the other two sources
and puts all three in front of the reader.

- **Typing telemetry (item 5):** `components/Editor.tsx` already has an
  `updateListener`; add a counter for inserted vs deleted characters and flag
  large single insertions as paste. Feed `record.ts`. Backspace ratio is the
  number worth trending — it is the accuracy signal, and unlike raw WPM it does
  not punish thinking.
- **Process markers (item 6):** split by how they are known. `timeToFirstTestRun`
  is `runs[0].at - enteredAt` — exact, free, no model. "Restated the problem",
  "asked a clarifying question", "stated complexity unprompted" are model-judged
  and belong in the report prompt as a checklist it must fill in.
- Report and progress page: a compact metrics strip per round, and the trend
  across sessions on `/history` beside the existing content/delivery chart.

*Risk:* this is the phase most likely to produce a dashboard nobody reads. The
guard is the backlog's own framing — a number is only worth showing if it can
*move*. Ship the three that move (agency ratio, talk-time ratio, backspace ratio)
and hold the rest until there is data saying they matter.

### Phase 5 — the compounding half (items 7 and 8)

Deliberately after 2–4, because a weakness ledger with nothing to remember is an
empty screen, and a drill with no banks to draw from is a menu with no dishes.

- **Weakness ledger (item 7):** history rows currently store the *count* of
  covered points. They need the missed indices too — a small addition to
  `Attempt`, resolvable to text server-side the way the report already does it.
  Then weight selection, and retire a point after two consecutive passes.
- **Pre-interview drill (item 8):** mostly `buildSession` over a role-filtered
  catalogue. Seed the two roles named in the backlog.

*Note on ordering:* the backlog puts the drill at P2 while saying it is "the mode
that would actually get opened the morning of one" — and there are interviews
booked. That tension resolves once Phases 2 and 3 land: at that point the banks
alone are usable the morning of an interview without the drill wrapper. The
wrapper is convenience; the banks are the substance.

### Phase 6 — realism (items 9 and 10)

- **Cold open and the clock (item 9):** cold open is a prompt change plus a stage
  type. The "five minutes left" warning is a `SessionBar` addition, and should be
  *spoken* as well as shown — an interviewer saying it is the thing being
  rehearsed. Both cheap.
- **Self-view (item 10):** honestly the largest new surface for the least reuse —
  `getUserMedia` video, `MediaRecorder`, blob storage, playback UI, and a hard
  rule that nothing leaves the machine. The backlog calls it highest-yield and
  that is probably true, but it shares nothing with the rest of the app, so it is
  the one item that could be done at any time or dropped without affecting
  anything else.

## Sizing

| Phase | Items | Rough size | Needs an API key |
|---|---|---|---|
| 0 | housekeeping | 30 min | no |
| 1 | speech metrics + STT timings | half a day | no (verification is offline) |
| 2 | behavioral | a day, mostly content | yes, for verify:report |
| 3 | rapid-fire + C# bank | two days, mostly content | yes, for the batched grader |
| 4 | telemetry | a day | yes |
| 5 | ledger + drill | a day | no |
| 6 | cold open, self-view | half a day + a day | no |

## What this plan does not change

Carried from the backlog's own list, and agreed with: the grader as a separate
model call, evidence accumulated in the browser, `verify:bundle` grepping
prerendered output, practical problems before algorithms, and local Kokoro TTS by
default.

One addition to that list: **the conversational turn machine should not be bent
to fit rapid-fire.** It exists to hold a conversation, and rapid-fire is not one.
Two small drivers are better than one general one, and this is exactly the kind of
merge that looks elegant and produces a round that is bad at both.
