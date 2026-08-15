import type { DiscussionProblem, Language, Problem, Rubric } from '@/lib/problems/types'
import type { LLMProvider, Message } from '../pipeline/llm'

/**
 * The post-session report.
 *
 * Two things make this different from asking a model "how did I do", and both are
 * enforced in the prompt rather than hoped for:
 *
 * **1. Every claim must be anchored to evidence.** The model gets the transcript
 * with timestamps, every test run, every hint, and the starter code alongside what
 * was actually written. It is told to quote, and told that a dimension with no
 * evidence goes in `notAssessed` rather than getting a made-up score. A report
 * that says "good communication" is worth nothing; one that says "at 04:12 you
 * said X before writing anything" is worth reading.
 *
 * **2. Content and delivery are scored separately, and never contaminate each
 * other.** This is the whole reason `Rubric` has two axes. For someone
 * interviewing in a second language, "what you knew" and "how well you got it
 * across" have completely different remedies, and a single blended score hides
 * exactly the distinction they need. The test results make the split unusually
 * reliable here: passing tests are objective proof of what the code does, so
 * working code plus a thin explanation is a *delivery* finding by construction.
 *
 * The transcript comes from automatic speech recognition, which mangles accented
 * speech. The prompt says so explicitly, because a model shown a garbled sentence
 * will otherwise read it as confusion.
 */

/* ----------------------------------------------------------------- evidence */

export interface RoundEvidence {
  slug: string
  title: string
  label: string
  language: Language | null
  elapsedMs: number
  allottedMs: number
  transcript: { role: 'candidate' | 'interviewer'; text: string; at: number }[]
  hints: { level: number; text: string; at: number }[]
  /** Moments the interviewer flagged live, via `note_observation`. */
  observations?: {
    note: string
    axis: 'content' | 'delivery'
    significance: 'strength' | 'concern'
    at: number
  }[]
  runs: { at: number; passed: number; total: number; failing: string[]; compileError?: string }[]
  files: { path: string; content: string }[]
  enteredAt: number
  /**
   * What the coverage grader found, for a spoken round.
   *
   * `indices` are 1-based into the points ordered essential-first — the same
   * numbering the interviewer and the grader used, and the same list the
   * candidate was shown at the end of the round. Without this the report
   * re-derives coverage from the transcript on its own and can contradict that
   * list, which is the one piece of feedback they have already read.
   */
  objectives?: { covered: number; total: number; essential: number; indices?: number[] }
  /** The interviewer's closing call, if it ended the round itself. */
  concluded?: { verdict: 'strong' | 'solid' | 'mixed' | 'weak'; summary: string }
}

export interface ReportRequest {
  sessionName: string
  startedAt: number
  endedAt: number
  rounds: {
    evidence: RoundEvidence
    /** Loaded server-side, so the answer key stays out of the browser. */
    problem: Problem | DiscussionProblem
  }[]
}

/* ------------------------------------------------------------------- output */

export interface AxisVerdict {
  /** 1–5. See the anchors in the prompt; 3 is "what you'd expect", not "bad". */
  score: number
  comment: string
}

export interface Moment {
  /** mm:ss into the round. */
  at: string
  /** Verbatim transcript when `spoken`, otherwise a description of the event. */
  quote: string
  /**
   * True when this is a quotation from the transcript.
   *
   * Not decoration: it is what makes a citation checkable. A quoted moment can be
   * matched against what was actually said, and `verify:report` does exactly
   * that — a fabricated quote is the failure that would make this whole report
   * worthless, and it is invisible without the flag.
   */
  spoken: boolean
  comment: string
}

/**
 * The language-versus-knowledge reading, as an enum rather than only prose.
 *
 * The prose is what the candidate reads; this is what the UI badges and what
 * verification asserts on. Matching a regex against free text was brittle enough
 * to fail on a diagnosis that was entirely correct.
 */
export type DiagnosisKind =
  /** Knows it, struggles to say it. Remedy is rehearsal, not study. */
  | 'expression-lags-knowledge'
  /** Says it well, does not know it. The more dangerous of the two. */
  | 'knowledge-lags-expression'
  | 'both-solid'
  | 'both-weak'
  | 'not-enough-evidence'

export interface RoundVerdict {
  slug: string
  title: string
  outcome: 'solved' | 'partial' | 'not-solved' | 'not-attempted'
  content: AxisVerdict
  /** Null when nothing was said out loud — there is then nothing to judge. */
  delivery: AxisVerdict | null
  /** The explicit language-versus-knowledge read. Null with no speech. */
  diagnosis: string | null
  diagnosisKind: DiagnosisKind | null
  moments: Moment[]
  didWell: string[]
  doDifferently: string[]
}

export interface Report {
  generatedAt: number
  sessionName: string
  headline: string
  rounds: RoundVerdict[]
  /** Patterns that showed up in more than one round. */
  themes: string[]
  /** Concrete things to drill next, in priority order. */
  practice: string[]
  /** Rubric dimensions with no evidence, and why. Never silently scored. */
  notAssessed: string[]
}

/* ------------------------------------------------------------------- prompt */

const RULES = `You are writing a debrief for someone who has just finished a practice technical interview. Write to them directly, as "you".

EVIDENCE IS MANDATORY.
- Every judgement must point at something that actually happened: a quoted line from the transcript, a test run, a hint taken, or a specific piece of the code they wrote.
- Quote verbatim. Do not paraphrase a quote and present it as one.
- If a rubric dimension has no evidence either way, do NOT score it and do NOT guess. Name it in "notAssessed" with one clause saying why.
- Generic praise is forbidden. "Good communication", "solid understanding", "keep it up" — none of these are findings. If you cannot attach it to a moment, cut it.
- Be honest. This is practice, and an inflated score wastes their time. Most competent answers are a 3.

SCORE CONTENT AND DELIVERY SEPARATELY. They must not contaminate each other.
- content  = what they actually knew and did. The code is the evidence.
- delivery = how they got it across: structure, precision of terms, thinking aloud, responding to pushback.
- Working code with a thin explanation is a DELIVERY finding. It is not a content finding. The tests prove what the code does.
- A fluent, confident explanation of something wrong is a CONTENT finding. It is not a delivery finding. Do not deduct delivery for it. Someone who explains a wrong answer clearly has still explained it clearly, and saying otherwise buries the actual finding.
- Failing to notice that their code contradicts what they said, misreading a test failure, or defending a wrong answer under pushback are all CONTENT findings. Never take delivery marks off for them.
- Delivery asks one question only: could a listener follow what they meant? Nothing about whether they were right belongs on this axis.
- HARD RULE ON THE DELIVERY COMMENT: it must not contain a single statement about whether they were right, whether the code worked, whether tests passed, or whether they noticed a mistake. If you catch yourself writing one, move it to the content comment. A delivery comment that mentions correctness is a defect, and so is a delivery score that quietly reflects it.

Score anchors, both axes:
1 = absent, or actively wrong
2 = attempted, mostly missed
3 = competent — what you would expect from someone who can do the job
4 = strong
5 = exceptional

THE TRANSCRIPT IS AUTOMATIC SPEECH RECOGNITION OF A NON-NATIVE ENGLISH SPEAKER.
- It contains transcription errors. Words will be wrong. Sentences will be clipped.
- Never treat a grammatical error, a missing article, a wrong preposition, a wrong tense, or a mangled word as evidence about technical knowledge. It is not.
- If a sentence is broken but the technical content in it is correct, the content is correct.
- Filler and self-correction while thinking are normal speech, not confusion.
- A misheard or mispronounced word is not evidence about EITHER axis. "Race" for "raise" is the transcriber, not them. "Using precise technical terms" means reaching for the wrong concept — calling a hash map an array — never mispronouncing the right one. Do not mention it.

QUOTE ACCURATELY. Copy the timestamp from the line you are quoting exactly as it appears in square brackets. Do not estimate it.

THE DIAGNOSIS is the most useful thing in this report. For each round, pick exactly one "diagnosisKind" and then say in prose which specific evidence made you pick it:
- "expression-lags-knowledge" — the code works, or the reasoning is sound, but the spoken account was thin, hesitant, or hard to follow. Remedy is rehearsal and vocabulary, not study.
- "knowledge-lags-expression" — fluent, well-structured, and wrong or shallow. Remedy is study. Say this plainly; a confident delivery hiding a gap is the more dangerous of the two.
- "both-solid" — say so, and say what would stretch them.
- "both-weak" — say which to fix first and why.
- "not-enough-evidence" — not enough was said to tell. Say that instead of guessing.

Cite between two and five moments per round. Prefer moments that changed the outcome: the point where they saw the bug, the point where they went quiet, the question they answered well, the wrong turn they took.`

const SCHEMA = `Reply with ONE JSON object, no prose around it, exactly this shape:

{
  "headline": "one sentence, the single most useful thing to tell them",
  "rounds": [
    {
      "slug": "the round's slug, copied exactly",
      "outcome": "solved" | "partial" | "not-solved" | "not-attempted",
      "content": { "score": 1-5, "comment": "2-4 sentences, evidence-anchored" },
      "delivery": { "score": 1-5, "comment": "2-4 sentences" } | null,
      "diagnosisKind": one of the five values above | null,
      "diagnosis": "2-4 sentences saying which evidence made you pick that" | null,
      "moments": [ { "at": "mm:ss", "spoken": true, "quote": "verbatim from the transcript", "comment": "why it matters" } ],
      "didWell": ["specific, evidence-anchored"],
      "doDifferently": ["specific and actionable"]
    }
  ],
  "themes": ["patterns that appeared in more than one round; empty array if only one round"],
  "practice": ["concrete things to drill next, hardest-hitting first"],
  "notAssessed": ["rubric dimension — one clause on why there was no evidence"]
}

Set "delivery", "diagnosis" and "diagnosisKind" to null for any round where nothing was said out loud.

Set "spoken" to false for a moment that is not a quotation — a test run, a hint taken, a long silence, a change to the code. Then "quote" describes the event instead. Set it to true only when the text is copied from the transcript word for word.`

/* ----------------------------------------------------------------- rendering */

/** mm:ss into the round. This is what makes a citation checkable. */
function stamp(at: number, roundStart: number): string {
  const total = Math.max(0, Math.round((at - roundStart) / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function minutes(ms: number): string {
  return `${Math.round(ms / 60_000)} min`
}

function rubricLines(rubric: Rubric): string[] {
  return [
    `Content dimensions: ${rubric.content.join(', ')}.`,
    `Delivery dimensions: ${rubric.delivery.join(', ')}.`,
  ]
}

/**
 * The starter code for a round, so the model can tell what they actually wrote
 * from what was handed to them.
 *
 * Without this the model cannot distinguish an untouched file from a deliberate
 * decision to leave one alone, and it will confidently credit them for code that
 * came with the problem.
 */
function starterFor(problem: Problem | DiscussionProblem, language: Language | null): Map<string, string> {
  const map = new Map<string, string>()
  if (language === null) return map
  if (problem.kind === 'workspace') {
    for (const file of problem.files[language] ?? []) map.set(file.path, file.content)
  } else if (problem.kind === 'algorithm') {
    map.set(`solution.${language === 'python' ? 'py' : 'ts'}`, problem.starterCode[language] ?? '')
  }
  return map
}

/**
 * Essential points first, then the rest.
 *
 * This ordering *is* the numbering. The interviewer's prompt, the grader's
 * prompt, the pips the candidate watches and the list revealed at the end all
 * derive point numbers this way, so anything that renumbers here silently
 * reassigns every recorded tally.
 */
function orderedPoints(problem: DiscussionProblem) {
  return [
    ...problem.expectedPoints.filter((p) => p.essential),
    ...problem.expectedPoints.filter((p) => !p.essential),
  ]
}

/**
 * What the grader concluded, rendered for the report.
 *
 * Told to outrank the model's own reading for the same reason the interviewer's
 * live observations are: this was decided by something that read the transcript
 * with the answer key in hand, and it is what the candidate was shown. A report
 * that quietly disagrees with the panel from thirty seconds earlier is worse
 * than one that says less.
 */
function coverageLines(problem: DiscussionProblem, evidence: RoundEvidence): string[] {
  const indices = evidence.objectives?.indices
  if (!indices) return []

  const points = orderedPoints(problem)
  const reached = points.map((_, i) => i + 1).filter((n) => indices.includes(n))
  const missed = points.map((_, i) => i + 1).filter((n) => !indices.includes(n))

  const lines = [
    'WHAT THEY ACTUALLY REACHED, AS SCORED DURING THE ROUND:',
    'Decided by a separate grader reading the whole transcript against the numbered list',
    'above, and already shown to them when the round ended. Treat it as settled. Do not',
    'credit them for a point listed as never reached, and do not contradict this tally —',
    'if your own reading disagrees, the interesting thing is *why*, and that belongs in',
    'the comment rather than in a different score.',
    reached.length > 0 ? `Reached: ${reached.join(', ')}` : 'Reached: none of them.',
  ]

  if (missed.length > 0) {
    lines.push('Never reached:')
    for (const n of missed) {
      lines.push(`${n}. ${points[n - 1].essential ? '[essential] ' : ''}${points[n - 1].point}`)
    }
    lines.push(
      'Name the essential ones they missed, in their own words, in the round comment.',
      'That is the most useful sentence in this whole report: it is the specific thing',
      'to go and learn.',
    )
  }

  if (evidence.concluded) {
    lines.push(
      '',
      `The interviewer closed the round itself, calling it "${evidence.concluded.verdict}": ` +
        evidence.concluded.summary,
    )
  }

  return lines
}

/** The answer key. Server-side only — this is the whole reason it exists. */
function answerKey(problem: Problem | DiscussionProblem, language: Language | null): string[] {
  const lines: string[] = []

  if (problem.kind === 'discussion') {
    lines.push('WHAT A GOOD ANSWER REACHES (they never saw this):')
    // Numbered, essential-first, matching the numbering the grader used — the
    // coverage block below refers to these numbers.
    orderedPoints(problem).forEach((point, i) => {
      lines.push(
        `${i + 1}. ${point.essential ? '[essential] ' : ''}${point.point}` +
          (point.weakAnswer ? ` — a weak answer says instead: ${point.weakAnswer}` : ''),
      )
    })
    return lines
  }

  if (language === null) return lines

  if (problem.kind === 'algorithm') {
    const solution = problem.referenceSolution[language]
    if (solution) {
      lines.push('REFERENCE SOLUTION (they never saw this — judge their code against it):', solution)
    }
  } else {
    const patch = problem.referencePatch[language]
    if (patch) {
      lines.push('REFERENCE FIX (they never saw this — judge their code against it):')
      for (const [path, content] of Object.entries(patch)) {
        lines.push(`--- ${path} ---`, content)
      }
    }
  }
  return lines
}

function renderRound(
  { evidence, problem }: ReportRequest['rounds'][number],
  index: number,
): string {
  const { enteredAt } = evidence
  const lines: string[] = [
    `================ ROUND ${index + 1}: ${evidence.title} ================`,
    `slug: ${evidence.slug}`,
    `kind: ${problem.kind}${problem.kind === 'workspace' ? ` (${problem.variant})` : ''}${
      problem.kind === 'discussion' ? ` (${problem.format})` : ''
    }`,
    `difficulty: ${problem.difficulty}`,
    evidence.language ? `language: ${evidence.language}` : 'language: n/a (spoken round)',
    `time: ${minutes(evidence.elapsedMs)} spent` +
      (evidence.allottedMs > 0 ? ` of ${minutes(evidence.allottedMs)} suggested` : ''),
    '',
    'PROBLEM STATEMENT AS THEY SAW IT:',
    problem.statement.trim(),
  ]

  if (problem.kind === 'workspace') lines.push('', `Goal given to them: ${problem.goal}`)
  if (problem.kind === 'discussion') lines.push('', `Question asked: ${problem.prompt}`)

  lines.push('', ...rubricLines(problem.rubric))

  const key = answerKey(problem, evidence.language)
  if (key.length > 0) lines.push('', ...key)

  if (problem.kind === 'discussion') {
    const coverage = coverageLines(problem, evidence)
    if (coverage.length > 0) lines.push('', ...coverage)
  }

  /* --- what they wrote ---------------------------------------------------- */

  if (evidence.files.length > 0) {
    const starter = starterFor(problem, evidence.language)
    lines.push('', 'THEIR CODE AT THE END OF THE ROUND:')
    for (const file of evidence.files) {
      const original = starter.get(file.path)
      if (original !== undefined && original.trim() === file.content.trim()) {
        lines.push('', `--- ${file.path} --- (unchanged from the starter)`)
        continue
      }
      lines.push('', `--- ${file.path} ---`, file.content.trimEnd())
      if (original !== undefined) {
        lines.push('', `--- ${file.path} as it was handed to them ---`, original.trimEnd())
      }
    }
  } else if (problem.kind !== 'discussion') {
    lines.push('', 'THEY WROTE NO CODE AT ALL.')
  }

  /* --- what happened ------------------------------------------------------ */

  lines.push('', 'TEST RUNS:')
  if (evidence.runs.length === 0) {
    lines.push('They never ran the tests.')
  } else {
    for (const run of evidence.runs) {
      lines.push(
        run.compileError
          ? `${stamp(run.at, enteredAt)} — did not compile: ${run.compileError.split('\n')[0]}`
          : `${stamp(run.at, enteredAt)} — ${run.passed} of ${run.total} passing` +
              (run.failing.length > 0 ? ` (failing: ${run.failing.join(', ')})` : ''),
      )
    }
  }

  /*
   * The interviewer's own notes, taken while the round was still running.
   *
   * These outrank anything reconstructed from the transcript, and are told to
   * outrank it: they were written before the round's outcome was known, by the
   * only observer who was actually there. Reading a transcript afterwards makes
   * everything look inevitable.
   */
  const observations = evidence.observations ?? []
  if (observations.length > 0) {
    lines.push(
      '',
      'WHAT THE INTERVIEWER NOTED AT THE TIME (they never saw these):',
      'Written live, before the outcome was known. Weigh them above your own reading of',
      'the transcript, and say so when one of them is the basis for a judgement.',
    )
    for (const observation of observations) {
      lines.push(
        `${stamp(observation.at, enteredAt)} — [${observation.axis}, ${observation.significance}] ${observation.note}`,
      )
    }
  }

  lines.push('', 'HINTS TAKEN:')
  if (evidence.hints.length === 0) {
    lines.push('None.')
  } else {
    for (const hint of evidence.hints) {
      lines.push(`${stamp(hint.at, enteredAt)} — hint ${hint.level}: ${hint.text}`)
    }
  }

  lines.push('', 'TRANSCRIPT:')
  if (evidence.transcript.length === 0) {
    lines.push(
      'Nothing. They worked in silence — the interviewer was never connected, or they never spoke.',
      'Set delivery and diagnosis to null for this round.',
    )
  } else {
    for (const line of evidence.transcript) {
      const who = line.role === 'candidate' ? 'THEM' : 'INTERVIEWER'
      lines.push(`[${stamp(line.at, enteredAt)}] ${who}: ${line.text}`)
    }
  }

  return lines.join('\n')
}

/* -------------------------------------------------------------------- parse */

/**
 * Parses the model's reply, tolerating a fenced block.
 *
 * JSON mode should make the fence impossible, but a report that dies on a stray
 * ```json is a worse failure than a slightly forgiving parser.
 */
function parse(raw: string): unknown {
  const trimmed = raw.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)
  return JSON.parse(fenced ? fenced[1] : trimmed)
}

function asAxis(value: unknown): AxisVerdict | null {
  if (typeof value !== 'object' || value === null) return null
  const { score, comment } = value as { score?: unknown; comment?: unknown }
  if (typeof comment !== 'string') return null
  const numeric = typeof score === 'number' ? score : Number(score)
  return {
    score: Number.isFinite(numeric) ? Math.min(5, Math.max(1, Math.round(numeric))) : 3,
    comment,
  }
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

const OUTCOMES = new Set(['solved', 'partial', 'not-solved', 'not-attempted'])

const DIAGNOSIS_KINDS = new Set<DiagnosisKind>([
  'expression-lags-knowledge',
  'knowledge-lags-expression',
  'both-solid',
  'both-weak',
  'not-enough-evidence',
])

/* ---------------------------------------------------------------- generation */

export async function generateReport(
  llm: LLMProvider,
  request: ReportRequest,
): Promise<Report> {
  if (request.rounds.length === 0) {
    throw new Error('Nothing to report on — no rounds were recorded.')
  }

  const messages: Message[] = [
    { role: 'system', content: `${RULES}\n\n${SCHEMA}` },
    {
      role: 'user',
      content: [
        `SESSION: ${request.sessionName}`,
        `Total length: ${minutes(request.endedAt - request.startedAt)}, ${request.rounds.length} round(s).`,
        '',
        ...request.rounds.map((round, i) => renderRound(round, i)),
      ].join('\n'),
    },
  ]

  /*
   * Thinking is on and the budget is large: this runs once, after the session,
   * where a slow considered answer costs nothing. Reasoning tokens come out of
   * the same budget as the answer, so a tight cap returns an empty string rather
   * than a short report — `complete` throws with the token count when that
   * happens, which is how this number was found to be too small.
   *
   * Measured: three rounds spent all 12,000 on reasoning and produced nothing.
   * The budget has to scale with the session, because both halves do — more
   * rounds means more to think about *and* more JSON to write. A fixed number
   * fails silently on exactly the long sessions worth reporting on.
   */
  const budget = Math.min(60_000, 9_000 + request.rounds.length * 5_000)
  const raw = await llm.complete({ messages, maxTokens: budget, thinking: true, json: true })

  let parsed: Record<string, unknown>
  try {
    parsed = parse(raw) as Record<string, unknown>
  } catch {
    throw new Error(`The report came back unparseable. First 200 chars: ${raw.slice(0, 200)}`)
  }

  const byslug = new Map(request.rounds.map((r) => [r.evidence.slug, r.evidence.title]))

  const rounds: RoundVerdict[] = (Array.isArray(parsed.rounds) ? parsed.rounds : [])
    .map((value): RoundVerdict | null => {
      const round = value as Record<string, unknown>
      const slug = typeof round.slug === 'string' ? round.slug : ''
      if (!byslug.has(slug)) return null

      const content = asAxis(round.content)
      if (!content) return null

      const outcome = typeof round.outcome === 'string' && OUTCOMES.has(round.outcome)
        ? (round.outcome as RoundVerdict['outcome'])
        : 'partial'

      const moments = (Array.isArray(round.moments) ? round.moments : [])
        .map((m) => m as Record<string, unknown>)
        .filter((m) => typeof m.quote === 'string' && typeof m.comment === 'string')
        .map((m) => ({
          at: typeof m.at === 'string' ? m.at : '',
          // Defaults to false: an unmarked moment is treated as a description,
          // never as a quotation it might not be.
          spoken: m.spoken === true,
          quote: m.quote as string,
          comment: m.comment as string,
        }))

      return {
        slug,
        title: byslug.get(slug)!,
        outcome,
        content,
        delivery: asAxis(round.delivery),
        diagnosis: typeof round.diagnosis === 'string' ? round.diagnosis : null,
        diagnosisKind: DIAGNOSIS_KINDS.has(round.diagnosisKind as DiagnosisKind)
          ? (round.diagnosisKind as DiagnosisKind)
          : null,
        moments,
        didWell: asStrings(round.didWell),
        doDifferently: asStrings(round.doDifferently),
      }
    })
    .filter((r): r is RoundVerdict => r !== null)

  if (rounds.length === 0) {
    throw new Error('The report came back with no usable rounds. Try generating it again.')
  }

  return {
    generatedAt: Date.now(),
    sessionName: request.sessionName,
    headline: typeof parsed.headline === 'string' ? parsed.headline : '',
    rounds,
    themes: asStrings(parsed.themes),
    practice: asStrings(parsed.practice),
    notAssessed: asStrings(parsed.notAssessed),
  }
}
