import type { Language, Problem } from '@/lib/problems/types'
import type { LLMProvider, Message } from '../pipeline/llm'

/**
 * The "I'm stuck" hint.
 *
 * Deliberately anchored to the problem's own `hintLadder` rather than letting the
 * model improvise. The ladder is written vaguest-first so each rung nudges
 * without collapsing the exercise; an unanchored model asked for "a hint" tends
 * to explain the whole bug, which ends the round.
 *
 * The model's job is only to *phrase* the rung against the candidate's actual
 * code — "you're calling sleep on every iteration of that loop" lands, where the
 * generic "compare the number of sleeps against the number of attempts" does not.
 *
 * Text, never speech. A spoken hint would fight the turn-taking machinery and add
 * a second of synthesis to something the candidate wants immediately.
 */

export interface HintRequest {
  problem: Problem
  language: Language
  files: { path: string; content: string }[]
  /** How many hints they have already taken this round. */
  used: number
}

export interface HintResponse {
  text: string
  /** 1-based rung of the ladder this came from. */
  level: number
  remaining: number
  /** True when the ladder is spent and there is nothing further to give. */
  exhausted: boolean
}

export async function generateHint(
  llm: LLMProvider,
  { problem, language, files, used }: HintRequest,
): Promise<HintResponse> {
  const ladder = problem.hintLadder
  const level = Math.min(used, ladder.length - 1)
  const exhausted = used >= ladder.length

  if (exhausted) {
    return {
      // Said plainly rather than inventing a further hint. The last rung of a
      // ladder is already close to explicit, and grinding past it teaches
      // nothing — better to be honest that this one did not land.
      text:
        "You've used every hint for this one. Rather than hand you the answer, it's " +
        'worth ending the round here and reading the reference solution — then coming ' +
        'back to it cold in a few days.',
      level: ladder.length,
      remaining: 0,
      exhausted: true,
    }
  }

  const code = files
    .map((file) => `--- ${file.path} ---\n${file.content.trimEnd()}`)
    .join('\n\n')

  const messages: Message[] = [
    {
      role: 'system',
      content: [
        'You are helping someone who is stuck on a practice interview problem.',
        '',
        'You will be given one specific hint to deliver, and their current code.',
        'Your job is to phrase THAT hint against what they have actually written —',
        'point at the real line or variable — so it lands.',
        '',
        'Hard rules:',
        '- Deliver only the hint you are given. Do not give the next one.',
        '- Never state the bug outright, never write the fix, never paste corrected code.',
        '- Two sentences at most.',
        '- Plain prose. No preamble like "Here is a hint".',
        '- If their code has not changed from the starter, nudge them to start somewhere concrete.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `PROBLEM: ${problem.title}`,
        problem.statement,
        '',
        `THE HINT TO DELIVER (rung ${level + 1} of ${ladder.length}):`,
        ladder[level],
        '',
        `THEIR CURRENT CODE (${language}):`,
        code || '(they have not written anything yet)',
      ].join('\n'),
    },
  ]

  const text = await llm.complete({ messages, maxTokens: 200 })

  return {
    text: text.trim(),
    level: level + 1,
    remaining: ladder.length - (level + 1),
    exhausted: false,
  }
}
