import type { CatalogueEntry } from './catalogue'
import type { SessionStage, SessionTemplate, StagePick } from './templates'

/** A stage with its selector resolved to a concrete item. */
export interface ResolvedStage {
  label: string
  minutes: number
  slug: string
  title: string
  source: 'problem' | 'question'
}

export interface BuiltSession {
  templateId: string
  name: string
  stages: ResolvedStage[]
  /** Stages the template asked for but the catalogue could not satisfy. */
  unfilled: string[]
}

function matches(entry: CatalogueEntry, pick: StagePick): boolean {
  switch (pick.from) {
    case 'problem':
      return entry.source === 'problem' && entry.slug === pick.slug
    case 'question':
      return entry.source === 'question' && entry.slug === pick.slug
    case 'any-problem':
      if (entry.source !== 'problem') return false
      if (pick.kind && entry.kind !== pick.kind) return false
      if (pick.variant && entry.variant !== pick.variant) return false
      if (pick.difficulty && entry.difficulty !== pick.difficulty) return false
      if (pick.topics && !pick.topics.some((t) => entry.topics.includes(t))) return false
      return true
    case 'any-question':
      if (entry.source !== 'question') return false
      if (pick.format && entry.format !== pick.format) return false
      return true
  }
}

/**
 * Resolves a template against the catalogue.
 *
 * Two rules worth knowing:
 *
 * - **No repeats within a session.** A "three bug squashes" template with only
 *   two bug-squash problems yields two stages plus an `unfilled` entry, rather
 *   than handing you the same problem twice — which would waste the round.
 * - **Random among candidates.** Running the same loop twice gives different
 *   problems, which is the point of practising a *format*.
 */
export function buildSession(
  template: SessionTemplate,
  catalogue: CatalogueEntry[],
  random: () => number = Math.random,
): BuiltSession {
  const used = new Set<string>()
  const stages: ResolvedStage[] = []
  const unfilled: string[] = []

  const resolve = (stage: SessionStage): ResolvedStage | null => {
    const candidates = catalogue.filter((e) => !used.has(e.slug) && matches(e, stage.pick))
    if (candidates.length === 0) return null

    const chosen = candidates[Math.floor(random() * candidates.length)]
    used.add(chosen.slug)
    return {
      label: stage.label,
      minutes: stage.minutes,
      slug: chosen.slug,
      title: chosen.title,
      source: chosen.source,
    }
  }

  for (const stage of template.stages) {
    const resolved = resolve(stage)
    if (resolved) stages.push(resolved)
    else unfilled.push(stage.label)
  }

  return { templateId: template.id, name: template.name, stages, unfilled }
}

/** Builds a session from an explicit list of slugs, for the custom picker. */
export function buildCustomSession(
  slugs: string[],
  catalogue: CatalogueEntry[],
): BuiltSession {
  const bySlug = new Map(catalogue.map((e) => [e.slug, e]))
  const stages: ResolvedStage[] = []

  for (const slug of slugs) {
    const entry = bySlug.get(slug)
    if (!entry) continue
    stages.push({
      label: entry.source === 'question' ? 'Discussion' : 'Coding',
      // Questions state their own length; coding rounds default to the
      // 45 minutes almost every real loop allocates.
      minutes: entry.expectedMinutes ?? 45,
      slug: entry.slug,
      title: entry.title,
      source: entry.source,
    })
  }

  return { templateId: 'custom', name: 'Custom session', stages, unfilled: [] }
}
