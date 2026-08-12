'use client'

import type { Language } from '@/lib/problems/types'

/**
 * The candidate's in-progress code, persisted per problem.
 *
 * Without this a reload throws the round away. That is not a hypothetical: forty
 * minutes of a component build went missing that way, and a practice tool you
 * cannot trust with your work is one you stop opening.
 *
 * Deliberately separate from the evidence record. That is an append-only account
 * of what happened, sealed when the session ends; this is mutable working state
 * that outlives sessions and belongs to the *problem*, so coming back to a round
 * days later resumes where you left off.
 */

const STORAGE_KEY = 'interview-ai:drafts:v1'

/** `{ [problemSlug]: { [language]: { [path]: content } } }` */
type Store = Record<string, Partial<Record<Language, Record<string, string>>>>

function readAll(): Store {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return typeof parsed === 'object' && parsed !== null ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

/** Saved files for one problem and language, or null if nothing is stored. */
export function readDraft(slug: string, language: Language): Record<string, string> | null {
  const stored = readAll()[slug]?.[language]
  return stored && Object.keys(stored).length > 0 ? stored : null
}

export function writeDraft(
  slug: string,
  language: Language,
  files: Record<string, string>,
): void {
  if (typeof window === 'undefined') return
  try {
    const all = readAll()
    all[slug] = { ...all[slug], [language]: files }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // A full quota must not interrupt the round. The in-memory copy is intact;
    // only the ability to survive a reload is lost.
  }
}

/** Forgets a problem's drafts, so Reset really does start from the starter code. */
export function clearDraft(slug: string, language: Language): void {
  if (typeof window === 'undefined') return
  try {
    const all = readAll()
    if (all[slug]) {
      delete all[slug][language]
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
    }
  } catch {
    // Same reasoning as above.
  }
}
