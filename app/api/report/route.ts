import { NextResponse } from 'next/server'
import { getProblem } from '@/problems'
import { getQuestion } from '@/questions'
import { createDeepSeekProvider } from '@/server/pipeline/llm'
import { generateReport, type ReportRequest } from '@/server/interview/report'
import type { SessionRecord } from '@/lib/session/record'

/**
 * Turns a recorded session into a report.
 *
 * The browser sends what it observed; this route supplies what the browser must
 * never see. Reference solutions, reference patches and expected answer points
 * are loaded here and go straight into the model prompt, which is what lets the
 * report judge the code against a known-good version instead of guessing whether
 * it was any good. They are still absent from every served file.
 *
 * Plain HTTP rather than the voice socket, for the same reason hints are: the
 * report has to work for a session done in silence, with no microphone and no
 * voice server running.
 */

export const maxDuration = 120

export async function POST(request: Request) {
  let record: SessionRecord
  try {
    record = ((await request.json()) as { record?: SessionRecord }).record as SessionRecord
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 })
  }

  if (!record || !Array.isArray(record.rounds) || record.rounds.length === 0) {
    return NextResponse.json({ error: 'That session has no recorded rounds.' }, { status: 400 })
  }

  const rounds: ReportRequest['rounds'] = []
  for (const round of record.rounds) {
    const problem =
      round.source === 'question' ? getQuestion(round.slug) : getProblem(round.slug)
    // A slug that no longer exists — the problem set changed since the session —
    // is dropped rather than failing the whole report.
    if (!problem) continue
    rounds.push({ problem, evidence: { ...round, title: problem.title } })
  }

  if (rounds.length === 0) {
    return NextResponse.json(
      { error: 'None of the recorded rounds match a problem that still exists.' },
      { status: 400 },
    )
  }

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'DEEPSEEK_API_KEY is not set — add it to .env.local.' },
      { status: 500 },
    )
  }

  try {
    const report = await generateReport(createDeepSeekProvider(apiKey), {
      sessionName: record.name,
      startedAt: record.startedAt,
      endedAt: record.endedAt ?? Date.now(),
      rounds,
    })
    return NextResponse.json(report)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
