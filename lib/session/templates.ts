import type { Difficulty, DiscussionFormat, WorkspaceVariant } from '@/lib/problems/types'

/**
 * Session templates — the shape of a real interview loop, not a single problem.
 *
 * Stages pick by *selector* rather than a hard-coded slug. Two reasons: templates
 * stay valid as problems are added, and two runs of the same loop give you
 * different problems, which is the whole point of practising a format.
 *
 * The company-shaped templates are modelled on published loop structures, and
 * they're honest about what's missing: none of them include the behavioural or
 * culture rounds that every real loop has, because this tool has no content for
 * those. Each says so rather than implying the loop is complete.
 */

export type StagePick =
  | { from: 'problem'; slug: string }
  | { from: 'question'; slug: string }
  | {
      from: 'any-problem'
      kind?: 'algorithm' | 'workspace'
      variant?: WorkspaceVariant
      difficulty?: Difficulty
      /** Matches if the problem has *any* of these topics. */
      topics?: string[]
    }
  | { from: 'any-question'; format?: DiscussionFormat }

export interface SessionStage {
  /** Round name as an interviewer would announce it, e.g. "Coding 1". */
  label: string
  /** Suggested length. The timer counts past it rather than stopping anything. */
  minutes: number
  pick: StagePick
}

export interface SessionTemplate {
  id: string
  name: string
  /** One line describing the format and who runs it. */
  description: string
  /** What this template deliberately leaves out. Shown in the UI, never hidden. */
  omits?: string
  stages: SessionStage[]
}

export const SESSION_TEMPLATES: readonly SessionTemplate[] = [
  {
    id: 'google-style',
    name: 'Google-style loop',
    description:
      'Two algorithm rounds and a system design round. Heavy on data structures — ' +
      'the format big tech still gates on.',
    omits: 'The real loop also has a behavioural / "Googleyness" round.',
    stages: [
      {
        label: 'Coding 1',
        minutes: 45,
        pick: { from: 'any-problem', kind: 'algorithm', difficulty: 'easy' },
      },
      {
        label: 'Coding 2',
        minutes: 45,
        pick: { from: 'any-problem', kind: 'algorithm', difficulty: 'medium' },
      },
      {
        label: 'System design',
        minutes: 45,
        pick: { from: 'any-question', format: 'system-design' },
      },
    ],
  },
  {
    id: 'stripe-style',
    name: 'Stripe-style loop',
    description:
      'Debugging an unfamiliar codebase, then building on top of one. Practical ' +
      'engineering rather than competitive programming.',
    omits: 'The real loop also has a behavioural round.',
    stages: [
      {
        label: 'Bug bash',
        minutes: 45,
        pick: { from: 'any-problem', kind: 'workspace', variant: 'bug-squash' },
      },
      {
        label: 'Integration',
        minutes: 45,
        pick: { from: 'any-problem', kind: 'workspace', variant: 'extend' },
      },
      {
        label: 'System design',
        minutes: 45,
        pick: { from: 'any-question', format: 'system-design' },
      },
    ],
  },
  {
    id: 'meta-style',
    name: 'Meta-style loop',
    description:
      'Two coding rounds at pace, then product architecture. Meta expects two ' +
      'problems inside a single 45-minute coding round, so the clock is tight.',
    omits: 'The real loop also has behavioural and team-matching rounds.',
    stages: [
      {
        label: 'Coding 1',
        minutes: 25,
        pick: { from: 'any-problem', kind: 'algorithm', difficulty: 'easy' },
      },
      {
        label: 'Coding 2',
        minutes: 25,
        pick: { from: 'any-problem', kind: 'algorithm', difficulty: 'medium' },
      },
      {
        label: 'System design',
        minutes: 45,
        pick: { from: 'any-question', format: 'system-design' },
      },
    ],
  },
  {
    id: 'frontend-loop',
    name: 'Frontend loop',
    description:
      'Debug a live React component, review a hook, then talk through what the ' +
      'browser actually does.',
    stages: [
      {
        label: 'Component debugging',
        minutes: 45,
        pick: { from: 'any-problem', kind: 'workspace', variant: 'frontend' },
      },
      { label: 'Code review', minutes: 20, pick: { from: 'question', slug: 'code-review-search-hook' } },
      {
        label: 'Concepts',
        minutes: 20,
        pick: { from: 'question', slug: 'concept-request-lifecycle' },
      },
    ],
  },
  {
    id: 'backend-loop',
    name: 'Backend loop',
    description:
      'A database bug, a performance problem, and a design decision with no clean ' +
      'answer.',
    stages: [
      { label: 'Debugging', minutes: 40, pick: { from: 'problem', slug: 'sales-report-sql' } },
      { label: 'Performance', minutes: 30, pick: { from: 'problem', slug: 'n-plus-one-queries' } },
      { label: 'Trade-offs', minutes: 20, pick: { from: 'question', slug: 'tradeoff-queue-vs-direct' } },
      {
        label: 'System design',
        minutes: 45,
        pick: { from: 'any-question', format: 'system-design' },
      },
    ],
  },
  {
    id: 'algorithms-only',
    name: 'Algorithms only',
    description:
      'Three data-structure problems back to back. For grinding the format big tech ' +
      'still screens on.',
    stages: [
      {
        label: 'Warm-up',
        minutes: 25,
        pick: { from: 'any-problem', kind: 'algorithm', difficulty: 'easy' },
      },
      {
        label: 'Main',
        minutes: 45,
        pick: { from: 'any-problem', kind: 'algorithm', difficulty: 'medium' },
      },
      {
        label: 'Second main',
        minutes: 45,
        pick: { from: 'any-problem', kind: 'algorithm', difficulty: 'medium' },
      },
    ],
  },
  {
    id: 'debugging-only',
    name: 'Debugging only',
    description:
      'Nothing but broken code. Three unfamiliar codebases with something wrong in ' +
      'each.',
    stages: [
      {
        label: 'Bug 1',
        minutes: 40,
        pick: { from: 'any-problem', kind: 'workspace', variant: 'bug-squash' },
      },
      {
        label: 'Bug 2',
        minutes: 40,
        pick: { from: 'any-problem', kind: 'workspace', variant: 'bug-squash' },
      },
      {
        label: 'Bug 3',
        minutes: 40,
        pick: { from: 'any-problem', kind: 'workspace', variant: 'bug-squash' },
      },
    ],
  },
  {
    id: 'no-coding',
    name: 'Talking only',
    description:
      'No editor. Code review, a concept deep-dive, a diagnosis walkthrough and a ' +
      'design — the rounds people practise least.',
    stages: [
      { label: 'Code review', minutes: 20, pick: { from: 'any-question', format: 'code-review' } },
      { label: 'Concepts', minutes: 15, pick: { from: 'any-question', format: 'concept' } },
      { label: 'Diagnosis', minutes: 20, pick: { from: 'any-question', format: 'diagnosis' } },
      {
        label: 'System design',
        minutes: 45,
        pick: { from: 'any-question', format: 'system-design' },
      },
    ],
  },
  {
    id: 'quick-practice',
    name: 'Quick practice',
    description: 'One practical problem and one short question. About half an hour.',
    stages: [
      { label: 'Coding', minutes: 25, pick: { from: 'any-problem', kind: 'workspace' } },
      { label: 'Discussion', minutes: 12, pick: { from: 'any-question', format: 'concept' } },
    ],
  },
]

export function getTemplate(id: string): SessionTemplate | undefined {
  return SESSION_TEMPLATES.find((t) => t.id === id)
}

export function templateMinutes(template: SessionTemplate): number {
  return template.stages.reduce((total, stage) => total + stage.minutes, 0)
}
