/**
 * Problem definitions are TypeScript modules rather than JSON files.
 *
 * The plan called for `problem.json`, but problems are ~80% multi-line code and
 * markdown; in JSON that means escaping every newline and quote by hand, which is
 * both unreadable and easy to get wrong. TS modules give template literals, the
 * compiler checks every field, and the loader becomes a plain import. The data is
 * still fully declarative — nothing here is executable logic.
 *
 * There are two kinds of problem, and they differ in more than presentation:
 *
 * - `algorithm`  — one function, hidden expectations, a `pass` stub to fill in.
 *                  The LeetCode shape. Still worth practising: most loops keep at
 *                  least one of these.
 * - `workspace`  — several files, a test suite the candidate can *read*, and
 *                  starting code that already does something (broken, messy, or
 *                  incomplete). This is what practical rounds actually look like:
 *                  live debugging, refactoring, extending existing code.
 *
 * The distinction is load-bearing for the interviewer, not just the UI. In a bug
 * squash the failing test *is* the problem statement, so the interviewer should be
 * asking how you're narrowing down the cause — not whether you know a hash map.
 */

export type Language = 'python' | 'typescript'

export const LANGUAGES: readonly Language[] = ['python', 'typescript'] as const

export const LANGUAGE_LABELS: Record<Language, string> = {
  python: 'Python',
  typescript: 'TypeScript',
}

export type Difficulty = 'easy' | 'medium' | 'hard'

export interface ProblemBase {
  slug: string
  title: string
  difficulty: Difficulty
  /**
   * Which languages this problem can be attempted in. Defaults to all of them.
   *
   * Not every problem is language-agnostic, and pretending otherwise produces bad
   * exercises. A SQL problem needs a real database — Pyodide ships `sqlite3`, so
   * Python gets one for free while TypeScript would need a second WASM build. A
   * React problem is TypeScript-only by nature. Declaring this per problem is
   * honest; the alternative is padding out a fake counterpart in the other
   * language purely for symmetry.
   */
  languages?: readonly Language[]
  /** Drives the interviewer's follow-up questions; also shown as chips in the UI. */
  topics: string[]
  /** Markdown. Shown to the candidate and included verbatim in the model's frozen prefix. */
  statement: string
  /**
   * Escalating nudges, vaguest first. The interviewer walks down this ladder rather
   * than volunteering the answer — without it, it can only react, never lead.
   */
  hintLadder: string[]
  /** Asked once the work is done, to probe depth. */
  followUps: string[]
  /** Dimensions the post-session report scores against, split by axis. */
  rubric: Rubric
}

/**
 * Scoring is split into two independent axes, and that split is the whole point.
 *
 * A single "communication" line item conflates two very different failures: not
 * knowing the answer, and knowing it but not getting it across. For anyone
 * interviewing in a second language that distinction is the most useful thing a
 * report can tell them — the remedies are completely different, and a vague
 * "be clearer" is useless feedback either way.
 *
 * - `content`  — what they actually know. Scored from whether the expected points
 *                were reached, however clumsily they were phrased.
 * - `delivery` — how it was conveyed: structure, precision of terms, signposting.
 *
 * Scoring them separately lets the report say "content 8/9, delivery 4/10 — the
 * gap is expression, not knowledge", which is actionable. The strongest evidence
 * for that reading is free: the test results already prove what the code does, so
 * working code plus a thin explanation is a language signal, not a knowledge one.
 */
export interface Rubric {
  content: readonly string[]
  delivery: readonly string[]
}

/** Delivery dimensions common to any round where you talk while you work. */
export const SPOKEN_DELIVERY = [
  'thinking aloud rather than going silent',
  'structuring the explanation',
  'using precise technical terms',
  'responding to hints and pushback',
] as const

/* ------------------------------------------------------------------ algorithm */

export interface TestCase {
  /** Short label shown in the results panel, e.g. "empty input". */
  name: string
  /** Positional arguments spread into the entry-point function. */
  args: unknown[]
  expected: unknown
  /**
   * Hidden cases still run; `hidden` only suppresses their arguments in the UI
   * until after the run. Execution happens in the browser, so this is a
   * presentation flag, not a security boundary.
   */
  hidden?: boolean
}

/**
 * How a returned value is compared against `expected`.
 * - `deep-equal`  — structural equality, order-sensitive (the default)
 * - `unordered`   — top-level array compared as a multiset, for problems where
 *                   any ordering of the result is valid
 */
export type CompareMode = 'deep-equal' | 'unordered'

export interface AlgorithmProblem extends ProblemBase {
  kind: 'algorithm'
  /**
   * Function the candidate must implement; the harness calls exactly this name.
   * Per-language so each uses its own naming convention (`two_sum` vs `twoSum`) —
   * being asked to write snake_case in TypeScript is an immediate immersion break.
   */
  entryPoint: Partial<Record<Language, string>>
  /** Plain-English signature, so the interviewer can talk about it without reading code. */
  signatureHint: string
  starterCode: Partial<Record<Language, string>>
  /**
   * Never shown to the candidate and never sent to the model. Exists so the test
   * suite can prove each problem's cases are actually satisfiable in both runtimes.
   */
  referenceSolution: Partial<Record<Language, string>>
  tests: TestCase[]
  compare?: CompareMode
}

/* ------------------------------------------------------------------ workspace */

/**
 * What kind of practical round this is. Drives the interviewer's opening and the
 * questions it should be asking — "how are you narrowing that down?" for a bug
 * squash is nonsense during a refactor.
 */
export type WorkspaceVariant = 'bug-squash' | 'refactor' | 'extend' | 'data' | 'frontend'

export interface WorkspaceFile {
  /** Path as shown on the tab and used for imports, e.g. `billing.py`. */
  path: string
  content: string
  /**
   * Test files and shared helpers are read-only. Letting a candidate "fix" a bug
   * squash by editing the assertions defeats the exercise, and in a real repo the
   * test is the specification.
   */
  readOnly?: boolean
}

export interface WorkspaceProblem extends ProblemBase {
  kind: 'workspace'
  variant: WorkspaceVariant
  /** One line above the tabs, e.g. "Make the failing tests pass." */
  goal: string
  files: Partial<Record<Language, WorkspaceFile[]>>
  /** Which file the runner executes to collect tests. */
  testPath: Partial<Record<Language, string>>
  /**
   * Whether the suite is green before the candidate touches anything.
   *
   * Refactoring starts green — the whole point is that behaviour must not change,
   * so passing tests are necessary but nowhere near sufficient. Everything else
   * starts red. `verify:problems` asserts this per problem, which is what stops a
   * "bug squash" whose bug isn't actually covered by any test.
   */
  startingState: 'failing' | 'passing'
  /**
   * File contents that make the suite pass, keyed by path. Never shown to the
   * candidate and never sent to the model — it exists so verification can prove
   * the exercise is solvable.
   */
  referencePatch: Partial<Record<Language, Record<string, string>>>
}

/* ----------------------------------------------------------------- discussion */

/**
 * Non-coding technical questions — the verbal half of a real loop.
 *
 * These are stored but not yet playable: unlike every other kind, a discussion
 * question cannot grade itself. There is no test suite that can judge whether an
 * explanation of database indexes was any good, so the whole format depends on
 * the interviewer that doesn't exist yet.
 *
 * They're written now anyway because the rubric is the durable part. When the
 * interviewer lands it scores against `expectedPoints` directly, and the bank
 * doesn't need rewriting to suit whatever UI eventually wraps it.
 */
export type DiscussionFormat =
  | 'code-review'
  | 'concept'
  | 'trade-off'
  | 'diagnosis'
  | 'system-design'
  /**
   * The non-technical half of a loop: tell me about a time you…
   *
   * A format rather than a new `kind`, because structurally it *is* a discussion
   * question — a prompt, expected substance, no code, no test suite. Making it a
   * kind would have duplicated the room, the voice pipeline, the grader, the
   * record and the report to change one rubric.
   *
   * What genuinely differs is that much of what makes a behavioural answer good
   * is countable rather than judged — whether you claimed your own work, whether
   * you stopped inside two minutes, whether the last sentence landed on a fact.
   * See lib/session/speech.ts.
   */
  | 'behavioral'

export interface ExpectedPoint {
  /** What a good answer says, phrased as the point itself rather than a question. */
  point: string
  /**
   * True when a competent answer *must* reach this. The split matters: it's the
   * difference between "incomplete" and "missed something fundamental", and it
   * stops the interviewer from treating a bonus insight as a requirement.
   */
  essential?: boolean
  /** What a weak answer says instead — gives the interviewer something to probe. */
  weakAnswer?: string
}

export interface DiscussionProblem extends ProblemBase {
  kind: 'discussion'
  format: DiscussionFormat
  /** The question as the interviewer should ask it, verbatim. */
  prompt: string
  /**
   * Read-only material the candidate reads but never edits: code to review, a log
   * excerpt, a schema. Reuses WorkspaceFile so the same editor can display it.
   */
  context?: WorkspaceFile[]
  /** Rough length of a full answer, so the interviewer can pace the session. */
  expectedMinutes: number
  expectedPoints: ExpectedPoint[]
}

export type Problem = AlgorithmProblem | WorkspaceProblem

export const DISCUSSION_FORMAT_LABELS: Record<DiscussionFormat, string> = {
  'code-review': 'Code review',
  concept: 'Concept',
  'trade-off': 'Trade-off',
  diagnosis: 'Diagnosis',
  'system-design': 'System design',
  behavioral: 'Behavioural',
}

export const DISCUSSION_RUBRIC: Record<DiscussionFormat, Rubric> = {
  'code-review': {
    content: [
      'severity ranking',
      'reading unfamiliar code',
      'distinguishing style from bugs',
      'spotting the security issue',
    ],
    delivery: ['constructive framing', 'organising the feedback', 'naming the issues precisely'],
  },
  concept: {
    content: [
      'depth beyond the definition',
      'knowing the limits of the answer',
      'concrete examples',
      'naming the trade-off',
    ],
    delivery: [
      'structuring the explanation',
      'using precise technical terms',
      'saying when unsure rather than bluffing',
    ],
  },
  'trade-off': {
    content: [
      'naming the cost of each option',
      'asking about constraints first',
      'committing to a recommendation',
      'anticipating the failure modes',
    ],
    delivery: ['signposting the structure', 'stating the recommendation clearly'],
  },
  diagnosis: {
    content: [
      'methodical narrowing',
      'forming testable hypotheses',
      'reasoning from evidence not hunches',
      'knowing what to check first',
    ],
    delivery: [
      'thinking aloud rather than going silent',
      'saying what was ruled out and why',
      'stating the hypothesis before testing it',
    ],
  },
  'system-design': {
    content: [
      'clarifying scale before designing',
      'data model',
      'failure modes',
      'justifying trade-offs',
    ],
    delivery: [
      'driving the conversation rather than waiting',
      'structuring the walkthrough',
      'using precise technical terms',
    ],
  },
  /*
   * Content is the story; delivery is the telling.
   *
   * The split matters more here than anywhere else, because a behavioural answer
   * fails on delivery far more often than on content — the story is usually
   * fine and the telling is three minutes long, in the first person plural, with
   * no ending.
   */
  behavioral: {
    content: [
      'a specific situation rather than a general policy',
      'their own contribution, named',
      'a concrete outcome',
      'what changed permanently as a result',
    ],
    delivery: [
      'claiming the work: "I" where "I" is true',
      'finishing inside two minutes',
      'landing on a fact rather than trailing off',
      'answering the question that was asked',
    ],
  },
}

export function supportedLanguages(problem: Pick<ProblemBase, 'languages'>): readonly Language[] {
  return problem.languages ?? LANGUAGES
}

export const VARIANT_LABELS: Record<WorkspaceVariant, string> = {
  'bug-squash': 'Bug squash',
  refactor: 'Refactor',
  extend: 'Extend',
  data: 'Data wrangling',
  frontend: 'Frontend',
}

export const DEFAULT_RUBRIC: Rubric = {
  content: ['problem decomposition', 'correctness', 'complexity analysis', 'testing instinct'],
  delivery: [...SPOKEN_DELIVERY],
}

/**
 * Practical rounds are judged on different things. Complexity analysis barely
 * matters when squashing a bug; how methodically you narrowed it down is the
 * whole signal.
 */
export const WORKSPACE_RUBRIC: Record<WorkspaceVariant, Rubric> = {
  'bug-squash': {
    content: [
      'reproducing the failure',
      'hypothesis forming',
      'targeted fix over rewrite',
      'checking for adjacent breakage',
    ],
    delivery: [
      'narrating the search rather than going quiet',
      'saying what was ruled out and why',
      'explaining the diagnosis once found',
    ],
  },
  refactor: {
    content: [
      'preserving behaviour',
      'naming and structure',
      'knowing when to stop',
      'incremental steps',
    ],
    delivery: [
      'justifying each change',
      'saying what was deliberately left alone',
      'using precise terms for the smells',
    ],
  },
  extend: {
    content: [
      'reading existing code',
      'respecting existing callers',
      'code quality',
      'testing instinct',
    ],
    delivery: [
      'explaining the approach before writing it',
      'flagging assumptions out loud',
      'structuring the explanation',
    ],
  },
  data: {
    content: [
      'edge-case thinking',
      'handling malformed input',
      'code quality',
      'testing instinct',
    ],
    delivery: [
      'enumerating the cases out loud',
      'explaining the model clearly',
      'using precise technical terms',
    ],
  },
  frontend: {
    content: [
      'reading component state flow',
      'reproducing in the browser',
      'targeted fix over rewrite',
      'accessibility and semantics',
    ],
    delivery: [
      'describing the symptom precisely',
      'explaining the render cycle',
      'thinking aloud while investigating',
    ],
  },
}

/**
 * How each difficulty is tinted, shared so the picker and the rooms agree.
 *
 * It was defined privately in the picker and the rooms rendered flat grey, so
 * the same fact wore different clothes on different screens.
 */
export const DIFFICULTY_COLOR: Record<Difficulty, string> = {
  easy: 'text-pass',
  medium: 'text-warn',
  hard: 'text-fail',
}

/**
 * One colour per rubric axis, for every place either is drawn.
 *
 * Lives here rather than beside one of its readers because it has three: the
 * report's score tiles, the progress chart, and the per-attempt pips. Those last
 * two are on the same page and disagreed until recently, which is exactly what a
 * second copy of this mapping would bring back.
 */
export const AXIS_COLOR = { content: 'bg-accent', delivery: 'bg-warn' } as const
