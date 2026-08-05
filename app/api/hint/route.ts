import { NextResponse } from 'next/server'
import { getProblem } from '@/problems'
import { LANGUAGES, type Language } from '@/lib/problems/types'
import { createDeepSeekProvider } from '@/server/pipeline/llm'
import { generateHint } from '@/server/interview/hint'

/**
 * Hints go over plain HTTP rather than the voice socket.
 *
 * Being stuck should not require a working microphone. This way the button works
 * whether or not an interview is running, and a request/response shape fits a
 * one-shot text answer far better than a streaming duplex channel would.
 *
 * It also keeps the answer key server-side: the hint ladder never ships to the
 * browser, so the button cannot be short-circuited by reading the bundle.
 */

interface HintBody {
  problemSlug?: string
  language?: string
  files?: { path: string; content: string }[]
  used?: number
}

export async function POST(request: Request) {
  let body: HintBody
  try {
    body = (await request.json()) as HintBody
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 })
  }

  const problem = getProblem(body.problemSlug ?? '')
  if (!problem) {
    return NextResponse.json({ error: 'Unknown problem.' }, { status: 404 })
  }

  const language = body.language as Language
  if (!LANGUAGES.includes(language)) {
    return NextResponse.json({ error: 'Unknown language.' }, { status: 400 })
  }

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'DEEPSEEK_API_KEY is not set — add it to .env.local.' },
      { status: 500 },
    )
  }

  try {
    const hint = await generateHint(createDeepSeekProvider(apiKey), {
      problem,
      language,
      files: body.files ?? [],
      used: Math.max(0, body.used ?? 0),
    })
    return NextResponse.json(hint)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
