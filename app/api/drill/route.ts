import { NextResponse } from 'next/server'
import { getRapidFireSet } from '@/questions/canon'
import { createDeepSeekProvider } from '@/server/pipeline/llm'
import { gradeDrill, type DrillSubmission } from '@/server/interview/drill-grader'

/**
 * Marks a finished rapid-fire run.
 *
 * The browser sends what it said; this route supplies what the browser must
 * never see. The expected points are the answer key for a format where reading
 * them mid-run would be trivially easy and completely ruinous, so they are
 * loaded here and never leave — `toClientSet` strips them from the copy the room
 * gets, and `verify:bundle` greps the built output to prove it.
 *
 * Plain HTTP rather than the voice socket, matching /api/report. The socket is
 * for the round; the marking is a separate thing that happens after it, and
 * putting it on the wire would make it hostage to a connection the candidate no
 * longer needs.
 */

export const maxDuration = 60

export async function POST(request: Request) {
  let body: { setSlug?: string; answers?: DrillSubmission[] }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 })
  }

  const set = body.setSlug ? getRapidFireSet(body.setSlug) : undefined
  if (!set) {
    return NextResponse.json({ error: 'Unknown drill.' }, { status: 400 })
  }

  const answers = Array.isArray(body.answers) ? body.answers : []
  if (answers.length === 0) {
    return NextResponse.json({ error: 'That drill has no recorded answers.' }, { status: 400 })
  }

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'DEEPSEEK_API_KEY is not set — add it to .env.local.' },
      { status: 500 },
    )
  }

  try {
    const result = await gradeDrill(createDeepSeekProvider(apiKey), set, answers)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
