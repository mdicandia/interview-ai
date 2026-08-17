import type {
  Difficulty,
  DiscussionFormat,
  Language,
  WorkspaceVariant,
} from '@/lib/problems/types'
import { supportedLanguages } from '@/lib/problems/types'
import { PROBLEMS } from '@/problems'
import { QUESTIONS } from '@/questions'
import { RAPID_FIRE_SETS } from '@/questions/canon'

/**
 * Metadata-only view of everything practisable.
 *
 * Session building happens in the browser (it needs localStorage and a random
 * pick per run), but the browser must never see `referenceSolution` or a
 * question's `expectedPoints` — importing PROBLEMS from a client component would
 * drag both into the bundle. So a server component builds this summary and passes
 * it down as props; only these fields cross the boundary.
 */
export interface CatalogueEntry {
  slug: string
  title: string
  source: 'problem' | 'question'
  kind: 'algorithm' | 'workspace' | 'discussion'
  variant?: WorkspaceVariant
  format?: DiscussionFormat
  difficulty: Difficulty
  topics: string[]
  languages: Language[]
  /** Only set for questions, which carry their own suggested length. */
  expectedMinutes?: number
}

export function buildCatalogue(): CatalogueEntry[] {
  const problems: CatalogueEntry[] = PROBLEMS.map((problem) => ({
    slug: problem.slug,
    title: problem.title,
    source: 'problem',
    kind: problem.kind,
    variant: problem.kind === 'workspace' ? problem.variant : undefined,
    difficulty: problem.difficulty,
    topics: problem.topics,
    languages: [...supportedLanguages(problem)],
  }))

  const questions: CatalogueEntry[] = QUESTIONS.map((question) => ({
    slug: question.slug,
    title: question.title,
    source: 'question',
    kind: 'discussion',
    format: question.format,
    difficulty: question.difficulty,
    topics: question.topics,
    languages: [...supportedLanguages(question)],
    expectedMinutes: question.expectedMinutes,
  }))

  return [...problems, ...questions]
}

/**
 * The rapid-fire sets, as metadata only.
 *
 * Deliberately a second list rather than more `CatalogueEntry` rows. A catalogue
 * entry is something `buildSession` can resolve into a stage, and a drill is
 * not: it has its own room, its own driver and its own clock, and a session
 * template asking for "one rapid-fire round" would have to teach the session
 * store about a second kind of timer to get it. Keeping them apart means the
 * picker can offer both while nothing else has to know drills exist.
 */
export interface DrillEntry {
  slug: string
  title: string
  blurb: string
  difficulty: Difficulty
  topics: string[]
  questionCount: number
  seconds: number
}

export function buildDrills(): DrillEntry[] {
  return RAPID_FIRE_SETS.map((set) => ({
    slug: set.slug,
    title: set.title,
    blurb: set.blurb,
    difficulty: set.difficulty,
    topics: set.topics,
    questionCount: set.questions.length,
    seconds: set.seconds,
  }))
}
