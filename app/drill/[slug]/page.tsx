import { notFound } from 'next/navigation'
import { DrillRoom } from '@/components/DrillRoom'
import { RAPID_FIRE_SETS, getRapidFireSet, toClientSet } from '@/questions/canon'

/**
 * Server component. Loading the set here is what keeps `expectedPoints` — the
 * answer key — out of the client bundle, exactly as the question page does.
 *
 * It matters more here than anywhere else in the app. A discussion round runs
 * twenty minutes and reading the key would still leave you having to say it
 * convincingly; a rapid-fire question is sixty seconds, and the key is three
 * bullet points that answer it outright.
 */
export default async function DrillPage(props: PageProps<'/drill/[slug]'>) {
  // `params` is async in Next.js 16 — synchronous access was removed in this major.
  const { slug } = await props.params
  const set = getRapidFireSet(slug)
  if (!set) notFound()

  return <DrillRoom set={toClientSet(set)} />
}

export function generateStaticParams() {
  return RAPID_FIRE_SETS.map((set) => ({ slug: set.slug }))
}
