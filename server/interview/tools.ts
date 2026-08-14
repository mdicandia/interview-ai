import type { ToolSpec } from '../pipeline/llm'

/**
 * The interviewer's two tools.
 *
 * `run_tests` is executed by the *browser* — it owns Pyodide and the JS worker,
 * and the server has no runtime at all. So the server only emits a request and
 * the results come back later as an ordinary `test-results` message, which
 * already triggers a spoken reaction. That asynchrony is a feature: the tests
 * start running while the follow-up sentence is still being generated, so the
 * candidate sees something happen immediately rather than sitting in silence.
 *
 * `note_observation` never reaches the candidate. It exists so the report can
 * cite what the interviewer noticed *at the time* rather than only what can be
 * reconstructed from a transcript afterwards — the difference between "you said
 * X" and "this was the moment you stopped guessing and started bisecting".
 *
 * Two tools, not the four in the original plan. `advance_phase` and
 * `end_interview` are pacing controls, and pacing is currently the session
 * timer's job, which the candidate drives. Handing the model a way to end a
 * practice round early would fight the deliberate decision that the timer never
 * cuts anyone off.
 */

export const RUN_TESTS: ToolSpec = {
  name: 'run_tests',
  description:
    "Execute the candidate's code against the test suite. ONLY use this when they have " +
    'written or changed code and want to know whether it works: they say they are done, ' +
    'or they claim a specific fix works. ' +
    'If they ask you to run the tests, run them in that turn — do not defer, do not offer ' +
    'to read the code first. ' +
    'Do NOT use it to fill a turn, to avoid answering, or as a response to something they ' +
    'said rather than wrote. Do NOT run again when the code has not changed since the last ' +
    'run. Running the tests answers "does this code pass"; it answers nothing else. ' +
    'Say what you are doing in the same turn — never call this silently.',
  parameters: { type: 'object', properties: {}, required: [] },
}

export const NOTE_OBSERVATION: ToolSpec = {
  name: 'note_observation',
  description:
    'Record one moment for the report the candidate reads afterwards. Silent: they never ' +
    'see it and you must never mention it. This does not replace replying — reply as ' +
    'normal and call this alongside, in the same turn. ' +
    'Call it whenever any of these happen, because each is something the report needs and ' +
    'nothing else captures: they state something incorrect and act on it; they reach a ' +
    'genuine insight; they get unstuck; they assert something they cannot justify when ' +
    'pushed; they explain something in a way you struggled to follow; they check an ' +
    'assumption before relying on it. ' +
    'Do not call it for ordinary progress like reading a file or typing.',
  parameters: {
    type: 'object',
    properties: {
      note: {
        type: 'string',
        description:
          'What happened and why it is worth remembering, in one or two sentences. Be ' +
          'specific enough that it still makes sense an hour later.',
      },
      axis: {
        type: 'string',
        enum: ['content', 'delivery'],
        description:
          'content = what they know and do. delivery = how they got it across. Working ' +
          'code with a thin explanation is delivery. A confident wrong answer is content.',
      },
      significance: {
        type: 'string',
        enum: ['strength', 'concern'],
        description: 'Whether this counts for them or against them.',
      },
    },
    required: ['note', 'axis', 'significance'],
  },
}

/**
 * `note_observation` first, deliberately.
 *
 * With `run_tests` listed first the model reached for it on almost every turn —
 * measured 4 of 5, including "let's run the tests and see" as a reply to an
 * explanation that was hard to follow, which is bad interviewing and answers a
 * question nobody asked. Running tests is the concrete, satisfying-looking
 * action; silent bookkeeping loses to it unless it is put first and its trigger
 * conditions are made specific.
 */
export const INTERVIEWER_TOOLS: ToolSpec[] = [NOTE_OBSERVATION, RUN_TESTS]

/**
 * The tools for one kind of round.
 *
 * A spoken round has no editor and nothing to execute, so offering `run_tests`
 * there is not merely useless — a model handed a tool will look for a reason to
 * use it, and "let's run the tests" in the middle of a system design question is
 * worse than no tool at all.
 */
export function toolsFor(kind: 'algorithm' | 'workspace' | 'discussion'): ToolSpec[] {
  return kind === 'discussion' ? [NOTE_OBSERVATION] : INTERVIEWER_TOOLS
}

export interface Observation {
  note: string
  axis: 'content' | 'delivery'
  significance: 'strength' | 'concern'
  at: number
}

/**
 * Reads an observation out of the model's raw argument JSON.
 *
 * Defensive because the arguments are generated text: a truncated stream or a
 * hallucinated enum value must not take the turn down. An unparseable call is
 * dropped, and an unknown axis defaults to content rather than being invented.
 */
export function parseObservation(raw: string): Observation | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw || '{}')
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const { note, axis, significance } = parsed as Record<string, unknown>
  if (typeof note !== 'string' || note.trim() === '') return null

  return {
    note: note.trim(),
    axis: axis === 'delivery' ? 'delivery' : 'content',
    significance: significance === 'strength' ? 'strength' : 'concern',
    at: Date.now(),
  }
}
