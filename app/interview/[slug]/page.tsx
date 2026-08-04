import { notFound } from 'next/navigation'
import { InterviewRoom } from '@/components/InterviewRoom'
import { PROBLEMS, getProblem, toClientProblem } from '@/problems'

/**
 * Server component. Loading problems here rather than in the client is what keeps
 * `referenceSolution` out of the browser bundle entirely.
 */
export default async function InterviewPage(props: PageProps<'/interview/[slug]'>) {
  // `params` is async in Next.js 16 — synchronous access was removed in this major.
  const { slug } = await props.params
  const problem = getProblem(slug)
  if (!problem) notFound()

  return <InterviewRoom problem={toClientProblem(problem)} />
}

export function generateStaticParams() {
  return PROBLEMS.map((problem) => ({ slug: problem.slug }))
}
