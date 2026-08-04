import { notFound } from 'next/navigation'
import { QuestionRoom } from '@/components/QuestionRoom'
import { QUESTIONS, getQuestion, toClientQuestion } from '@/questions'

/**
 * Server component. Loading the question here is what keeps `expectedPoints` and
 * the probe ladder — the answer key — out of the client bundle entirely.
 */
export default async function QuestionPage(props: PageProps<'/question/[slug]'>) {
  // `params` is async in Next.js 16 — synchronous access was removed in this major.
  const { slug } = await props.params
  const question = getQuestion(slug)
  if (!question) notFound()

  return <QuestionRoom question={toClientQuestion(question)} />
}

export function generateStaticParams() {
  return QUESTIONS.map((question) => ({ slug: question.slug }))
}
