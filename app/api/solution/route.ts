import { NextResponse } from 'next/server'
import { getProblem } from '@/problems'
import { LANGUAGES, type Language } from '@/lib/problems/types'

/**
 * Reveals the reference solution.
 *
 * Over HTTP for the same reason hints are: the answer key must not be in the
 * browser bundle, so it can only arrive when explicitly asked for. This route
 * and `/api/report` are the only places it is ever read.
 *
 * There is a real argument against having this at all — an answer key one click
 * away is an answer key you will click. The argument for it is stronger: forty
 * minutes into a component build, with the hint ladder spent, the choice is
 * between reading the solution and abandoning the round having learned nothing.
 * A practice tool that will not show its working is just a worse test.
 *
 * The UI asks for confirmation and the report is told it was revealed, so the
 * cost is honest rather than hidden.
 */

interface SolutionBody {
  problemSlug?: string
  language?: string
}

export interface SolutionResponse {
  /** Whole files, keyed by path. Workspace problems patch a subset. */
  files: { path: string; content: string }[]
  /** What to read for, so it is a lesson rather than a diff to copy. */
  notes: string[]
}

export async function POST(request: Request) {
  let body: SolutionBody
  try {
    body = (await request.json()) as SolutionBody
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 })
  }

  const problem = getProblem(body.problemSlug ?? '')
  if (!problem) return NextResponse.json({ error: 'Unknown problem.' }, { status: 404 })

  const language = body.language as Language
  if (!LANGUAGES.includes(language)) {
    return NextResponse.json({ error: 'Unknown language.' }, { status: 400 })
  }

  const files: { path: string; content: string }[] = []

  if (problem.kind === 'workspace') {
    const patch = problem.referencePatch[language]
    if (!patch) {
      return NextResponse.json(
        { error: `This problem has no reference solution for ${language}.` },
        { status: 404 },
      )
    }
    for (const [path, content] of Object.entries(patch)) files.push({ path, content })
  } else {
    const solution = problem.referenceSolution[language]
    if (!solution) {
      return NextResponse.json(
        { error: `This problem has no reference solution for ${language}.` },
        { status: 404 },
      )
    }
    files.push({ path: `solution.${language === 'python' ? 'py' : 'ts'}`, content: solution })
  }

  /*
   * The hint ladder doubles as reading notes.
   *
   * It was written vaguest-first as the sequence of realisations the problem is
   * *about*, which is exactly what to look for in a finished solution. Reading
   * the code against them turns "here is the answer" into "here is where each
   * thing you were stuck on ended up".
   */
  return NextResponse.json({
    files,
    notes: problem.hintLadder,
  } satisfies SolutionResponse)
}
