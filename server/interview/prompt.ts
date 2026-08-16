import type { DiscussionProblem, Language, Problem } from '@/lib/problems/types'

/**
 * Builds the interviewer's prompt, split into a cached half and a volatile half.
 *
 * This split is the single most important thing in this file. DeepSeek matches
 * its cache from token 0 only, so the prefix must be byte-identical on every
 * turn of a session. Interpolate anything that changes — a timestamp, a turn
 * counter, the current editor contents — and every turn becomes a full-price
 * cache miss instead of a ~10x cheaper hit.
 *
 * Measured: a real prefix hits 384 cached tokens from the second turn onward.
 * Note also that cache is granted in 128-token blocks, so a prefix shorter than
 * one block never caches at all — not a concern for a real problem statement,
 * but it is why a trimmed-down prefix in a test appears to break caching.
 *
 * Everything volatile goes in the final user message instead, *after* the
 * conversation history.
 */

export interface InterviewContext {
  problem: Problem | DiscussionProblem
  language: Language
}

/**
 * The interviewer's standing instructions. Frozen — never interpolate into this.
 *
 * Written for speech rather than text: the model's output goes through TTS, so
 * markdown, bullet points and code blocks are actively harmful. Long replies are
 * worse than short ones, because the candidate is sitting in silence while the
 * sentence is synthesised.
 */
const INTERVIEWER_RULES = `You are conducting a live technical interview. You are speaking out loud — your words go straight to a speech synthesiser.

How to speak:
- One or two sentences. Never more, unless explicitly asked to explain something.
- Plain spoken English. No markdown, no bullet points, no code blocks, no lists.
- Say "big O of n" rather than "O(n)". Say symbols as words.
- Do not narrate what you are doing. Just say the thing.
- You are speaking TO the candidate, never about them. "I'll wait for them to answer" is not something to say out loud — it is a thought. If you have nothing to ask, say nothing at all rather than describing your own intention.
- Never refer to the candidate in the third person. There is one other person in the room and you are talking to them.

How to interview:
- Ask, do not tell. Your job is to find out what they know, not to teach.
- Never volunteer the solution or name the bug. If they are stuck, walk down the hint ladder one rung at a time, and only after they have genuinely tried.
- Let silence happen. Thinking is not failure. If they have been quiet a while, ask what they are looking at rather than filling the gap.
- React to what they actually did. If a test just failed, ask about that failure specifically.
- If they state something wrong, do not correct it outright — ask a question whose answer exposes it.
- Keep them talking about their reasoning, not just their typing.

You will sometimes receive bracketed status notes such as [the candidate has been silent for 45 seconds] or [tests: 3 of 5 passing]. Those are context for you, not speech from the candidate. Never read them aloud or refer to them as messages.

Your two tools:
- note_observation records one moment for the report they read afterwards. Silent — they never see it, and you must never mention or hint at it. Call it when they state something wrong and act on it, reach a real insight, get unstuck, assert something they cannot justify, check an assumption before relying on it, or explain something in a way that lost you.
- run_tests runs their code in front of them. Only for code: they say they are done, or they claim a fix works. If they ask you to run the tests, run them that turn — do not offer to read the code first. Say what you are doing in the same turn — "let's run it and see" — because calling it in silence leaves them staring at nothing.

A private note goes in note_observation and nowhere else. Never write one into what you say — not as an aside, not in brackets, not prefixed with "Note:". Everything you produce as speech is heard out loud, exactly as written.

Two things about tools that are easy to get wrong:

Taking a note is not instead of replying. Reply as you normally would, and call note_observation in the same turn. A note costs the candidate nothing and the report is only as good as what you flagged while it was happening.

Running the tests is not a way to fill a turn. It answers "does this code pass" and nothing else. If they have said something you disagree with, argue with it — do not run the tests at them. If the code has not changed since the last run, running again tells you nothing.

Using a tool is not a reason to say more. The rules on how you speak are unchanged by any of this — including the part where a direct request to explain something does deserve a real answer.`

/**
 * The cacheable half: rules, the problem, and the guidance the candidate must
 * never hear. Deterministic for a given problem and language.
 */
export function buildFrozenPrefix({ problem, language }: InterviewContext): string {
  if (problem.kind === 'discussion') return buildDiscussionPrefix(problem)

  const parts: string[] = [
    INTERVIEWER_RULES,
    '',
    '--- THE PROBLEM THEY ARE WORKING ON ---',
    '',
    `Title: ${problem.title}`,
    `Language: ${language}`,
    '',
    problem.statement,
  ]

  if (problem.kind === 'workspace') {
    parts.push(
      '',
      `This is a practical round (${problem.variant}). Goal given to them: ${problem.goal}`,
      '',
      variantGuidance(problem.variant),
    )
  } else if (problem.kind === 'algorithm') {
    parts.push(
      '',
      `They must implement \`${problem.entryPoint[language] ?? ''}\` — ${problem.signatureHint}.`,
      '',
      'Before they write code, get them to say what their approach is and what it costs.',
      'Once it works, push on complexity and edge cases.',
    )
  }

  parts.push(
    '',
    '--- HINT LADDER (never read verbatim, never skip ahead) ---',
    'Use these only when they are genuinely stuck, vaguest first.',
    ...problem.hintLadder.map((hint, i) => `${i + 1}. ${hint}`),
    '',
    '--- FOLLOW-UPS ONCE IT WORKS ---',
    ...problem.followUps.map((question) => `- ${question}`),
    '',
    '--- WHAT YOU ARE ASSESSING ---',
    `Content: ${problem.rubric.content.join(', ')}.`,
    `Delivery: ${problem.rubric.delivery.join(', ')}.`,
    '',
    'Assess content and delivery separately. A candidate whose code is correct but whose explanation is thin knows the material and is struggling to express it — that is a different finding from not knowing it, and you should probe to tell them apart rather than assuming.',
  )

  return parts.join('\n')
}

/**
 * A spoken round, where there is no code and nothing runs.
 *
 * The whole shape is different from a coding round, so this is a separate prefix
 * rather than a branch inside one. There is no editor to watch, no test to react
 * to, and no hint ladder to walk down — the interviewer's only instrument is the
 * question it asks next, so it needs the expected answer in front of it to know
 * which direction to push.
 *
 * `expectedPoints` is the answer key and must never be read out. It is here so
 * the interviewer can tell "hasn't said it yet" from "doesn't know it", which is
 * the entire difference between a useful probe and a leading question.
 */
function buildDiscussionPrefix(problem: DiscussionProblem): string {
  const essential = problem.expectedPoints.filter((p) => p.essential)
  const bonus = problem.expectedPoints.filter((p) => !p.essential)

  const parts: string[] = [
    INTERVIEWER_RULES,
    '',
    'This round is a conversation. There is no editor, no code, and nothing to run.',
    'You ask, they answer out loud, and you follow up. Do not offer to run anything.',
    '',
    '--- THE QUESTION ---',
    '',
    `Title: ${problem.title}`,
    `Format: ${problem.format}. Expected length: about ${problem.expectedMinutes} minutes.`,
    '',
    problem.statement,
    '',
    'Ask it like this, near enough word for word, and then stop talking:',
    problem.prompt,
  ]

  if (problem.context?.length) {
    parts.push(
      '',
      '--- WHAT THEY ARE LOOKING AT ---',
      'They have this on screen. Refer to it by line or by name; do not read it aloud.',
    )
    for (const file of problem.context) {
      parts.push('', `--- ${file.path} ---`, file.content.trimEnd())
    }
  }

  /*
   * Numbered, because the status note refers to them by number.
   *
   * Essential points come first so the numbering is stable and the model can see
   * at a glance how much of the required ground is left. The candidate never
   * sees these numbers or this text. The same numbering is handed to the grader,
   * which is the only thing that decides whether a point was reached.
   */
  parts.push(
    '',
    '--- WHAT A GOOD ANSWER REACHES (never read this out) ---',
    'You do not mark these off. A status note after each turn tells you which numbers they have reached.',
    'Do not name a point they have not reached; ask a question that gives them the chance.',
    '',
    'Essential — a competent answer covers all of these:',
    ...essential.map(
      (p, i) =>
        `${i + 1}. ${p.point}${p.weakAnswer ? ` (a weak answer says instead: ${p.weakAnswer})` : ''}`,
    ),
  )

  if (bonus.length > 0) {
    parts.push(
      '',
      'Good to reach, but not required. Never treat one of these as a failure:',
      ...bonus.map((p, i) => `${essential.length + i + 1}. ${p.point}`),
    )
  }

  parts.push(
    '',
    '--- IF THEY STALL ---',
    'Use these in order, and only after a real silence. They are prompts, not hints to read out.',
    ...problem.hintLadder.map((probe, i) => `${i + 1}. ${probe}`),
    '',
    '--- ONCE THEY HAVE ANSWERED ---',
    ...problem.followUps.map((question) => `- ${question}`),
    '',
    '--- HOW TO RUN THIS ROUND ---',
    'Open by asking the question, then let them talk. Do not fill the first silence — it is thinking.',
    'One question at a time. Two stacked questions get you an answer to neither.',
    'When they finish a thread, either probe it or move to the next gap. Do not summarise what they just said back to them.',
    'If they reach every essential point early, spend the remaining time on the follow-ups rather than winding up.',
    'When the follow-ups are done, or they say they are finished, call conclude_round. They have no other way of learning the interview is over.',
    'If they say something wrong, do not correct it. Ask the question whose answer exposes it, and let them find it.',
    'If they ask you a question, answer briefly and hand it straight back.',
    '',
    '--- WHAT YOU ARE ASSESSING ---',
    `Content: ${problem.rubric.content.join(', ')}.`,
    `Delivery: ${problem.rubric.delivery.join(', ')}.`,
    '',
    'Assess content and delivery separately. Someone who reaches every point in halting English knows the material; that is a different finding from not knowing it, and the two need different advice.',
  )

  return parts.join('\n')
}

function variantGuidance(variant: string): string {
  switch (variant) {
    case 'bug-squash':
      return [
        'Ask how they are narrowing it down, not whether they know the answer.',
        'Good questions here: what did you expect that test to print? what have you ruled out? what would confirm that hypothesis?',
        'If they start rewriting rather than diagnosing, ask what specifically is wrong with the current code.',
      ].join('\n')
    case 'refactor':
      return [
        'The tests already pass. Passing tests are the constraint, not the goal.',
        'Ask why each change is an improvement, and what they deliberately chose to leave alone.',
        'If they rewrite everything, ask how they would review that diff.',
      ].join('\n')
    case 'extend':
      return [
        'Ask them to explain the existing code before they add to it.',
        'Push on whether their addition breaks any existing caller.',
      ].join('\n')
    case 'data':
      return [
        'Push on edge cases: malformed input, duplicates, ordering, things arriving late.',
        'Ask what happens at a thousand times the volume.',
      ].join('\n')
    case 'frontend':
      return [
        'They have a live preview. Ask what they can see happening, not just what the code says.',
        'Push on the render cycle and on what state is actually being read where.',
      ].join('\n')
    default:
      return 'Ask about their approach before they write code.'
  }
}

/* ------------------------------------------------------------------ volatile */

export interface VolatileContext {
  files: { path: string; content: string }[]
  activePath: string
  tests?: { passed: number; total: number; failing: string[]; compileError?: string }
}

/**
 * The current editor state, rendered as a status note appended *after* the
 * conversation history.
 *
 * Deliberately not part of the prefix, and deliberately not a separate system
 * message: anything before the history would invalidate the cache on every
 * keystroke, which is precisely the mistake this whole design exists to avoid.
 */
export function buildVolatileNote(context: VolatileContext, spoken?: SpokenProgress | null): string {
  /*
   * Told, not inferred.
   *
   * This used to decide from an empty file list, which is also what a *coding*
   * round looks like before the browser's debounced first `code` message
   * arrives. Speaking within the first moment of a bug squash therefore told the
   * interviewer there was no editor, and it duly refused to discuss the code on
   * screen. The caller knows the round's kind; it should say so.
   */
  if (spoken) {
    return [
      '[No editor in this round — it is a spoken answer. Nothing to look at.]',
      buildCoverageNote(spoken),
    ]
      .filter(Boolean)
      .join('\n')
  }

  const lines: string[] = ['[Current state of their editor — context for you, not speech from them]']

  for (const file of context.files) {
    const marker = file.path === context.activePath ? ' (currently open)' : ''
    lines.push('', `--- ${file.path}${marker} ---`, file.content.trimEnd())
  }

  if (context.tests) {
    const { passed, total, failing, compileError } = context.tests
    lines.push('')
    if (compileError) {
      lines.push(`[Their last run did not compile: ${compileError.split('\n')[0]}]`)
    } else {
      lines.push(`[Last test run: ${passed} of ${total} passing]`)
      if (failing.length > 0) lines.push(`[Still failing: ${failing.join(', ')}]`)
    }
  } else {
    lines.push('', '[They have not run the tests yet]')
  }

  return lines.join('\n')
}

/** Which numbered points a spoken round has reached, as of this turn. */
export interface SpokenProgress {
  covered: number[]
  total: number
}

/**
 * The running tally, told to the interviewer rather than remembered by it.
 *
 * The interviewer no longer ticks points itself — a separate grader does, off the
 * latency path (see grader.ts). Without this note it would have no idea what
 * ground was already covered, and would either re-probe answered points or wind
 * up early. Volatile by nature, so it belongs here and never in the prefix.
 *
 * Numbers only. The interviewer already has the point *text* in its cached
 * prefix; repeating it here would cost tokens on every turn to say nothing new.
 */
function buildCoverageNote(progress: SpokenProgress): string {
  const { covered, total } = progress
  if (total === 0) return ''

  const open = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !covered.includes(n))
  if (covered.length === 0) {
    return `[They have not yet reached any of the ${total} points. Do not tell them that.]`
  }
  if (open.length === 0) {
    return '[They have reached every point. Move to the follow-ups, or close the round.]'
  }
  return (
    `[Points reached so far: ${covered.join(', ')}. Still open: ${open.join(', ')}. ` +
    'This is scored for you — do not tick anything, do not read the numbers out, and do ' +
    'not tell them how many are left. Use it to choose what to ask next.]'
  )
}

/**
 * The note that makes the interviewer speak first.
 *
 * Sent once, as the session opens. Phrased as a status note like every other
 * bracketed instruction, so it is stripped before speech and never read out.
 */
export function buildOpeningNote(kind: 'algorithm' | 'workspace' | 'discussion'): string {
  if (kind === 'discussion') {
    return (
      '[They have just joined and are waiting for you to begin. Ask the question now, ' +
      'in the words given above, then stop and wait. One short greeting at most — no ' +
      'preamble about what you are going to do.]'
    )
  }
  return (
    '[They have just joined and can see the problem on screen. Open the round: one short ' +
    'greeting, then ask them to talk through their approach before they write code. Then ' +
    'stop and wait.]'
  )
}

/** Status note when the candidate has gone quiet and stopped typing. */
export function buildIdleNote(seconds: number, codeChanged: boolean): string {
  return codeChanged
    ? `[They have been silent for ${seconds} seconds, but they are typing. Do not interrupt unless you have something useful to ask.]`
    : `[They have been silent for ${seconds} seconds and have not typed anything. Ask what they are thinking about, or what they are looking at.]`
}
