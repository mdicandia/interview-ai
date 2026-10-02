import type { RapidFireQuestion, RapidFireSet } from '@/lib/problems/types'
import { csharpFundamentals } from './csharp'
import { databaseFundamentals } from './databases'
import { generalFundamentals } from './general'
import { javascriptFundamentals } from './javascript'
import { reactFundamentals } from './react'
import { typescriptFundamentals } from './typescript'
import { webFundamentals } from './web'

/**
 * The rapid-fire banks: ten-ish questions, sixty seconds each, no discussion.
 *
 * Ordered by what has actually cost an offer. JavaScript and C# are first
 * because those two screens are the ones that ended in a rejection naming the
 * format, and a drill that buries the known weakness behind three warm-up sets
 * is a drill you stop before reaching it.
 *
 * Kept out of `QUESTIONS` for the same reason `QUESTIONS` is kept out of
 * `PROBLEMS`: a set is a list of prompts with no statement, no rubric and no
 * `expectedMinutes`, so it cannot share a type with a discussion question
 * without one of them growing fields it has no use for. It has its own room, its
 * own driver and its own grading pass.
 *
 * All of it is transcription, not authoring. the author's private notes are the
 * prose these come from — an interview canon and two Q&A banks, the last two being questions really asked with the answer
 * that should have been given. That provenance is the value: a model rewriting
 * them would produce the questions it expects rather than the ones that came up.
 */
export const RAPID_FIRE_SETS: readonly RapidFireSet[] = [
  javascriptFundamentals,
  csharpFundamentals,
  reactFundamentals,
  databaseFundamentals,
  generalFundamentals,
  typescriptFundamentals,
  webFundamentals,
]

const BY_SLUG = new Map(RAPID_FIRE_SETS.map((set) => [set.slug, set]))

export function getRapidFireSet(slug: string): RapidFireSet | undefined {
  return BY_SLUG.get(slug)
}

/**
 * The shape safe to send to a browser.
 *
 * The prompts go — they are the questions, and the room shows them so you are
 * not also fighting listening comprehension in a second language. The expected
 * points stay behind: they are the answer key, and this is the one format where
 * reading them mid-run would be trivially easy and completely ruinous.
 */
export type ClientRapidFireQuestion = Omit<RapidFireQuestion, 'expectedPoints'>

export type ClientRapidFireSet = Omit<RapidFireSet, 'questions'> & {
  questions: ClientRapidFireQuestion[]
}

export function toClientSet(set: RapidFireSet): ClientRapidFireSet {
  return {
    ...set,
    questions: set.questions.map(({ expectedPoints: _expectedPoints, ...rest }) => rest),
  }
}
