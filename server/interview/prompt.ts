import type { Language, Problem } from '@/lib/problems/types'

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
  problem: Problem
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
export function buildVolatileNote(context: VolatileContext): string {
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

/** Status note when the candidate has gone quiet and stopped typing. */
export function buildIdleNote(seconds: number, codeChanged: boolean): string {
  return codeChanged
    ? `[They have been silent for ${seconds} seconds, but they are typing. Do not interrupt unless you have something useful to ask.]`
    : `[They have been silent for ${seconds} seconds and have not typed anything. Ask what they are thinking about, or what they are looking at.]`
}
