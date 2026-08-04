/**
 * Verifies the server-side voice pipeline against the real APIs.
 *
 * Deliberately not mocked: every bug worth catching here — a silently ignored
 * parameter, a stream shape that isn't what the docs imply, an unfunded account
 * returning a valid-looking key — only shows up against the live service.
 *
 * Run with: pnpm verify:voice
 */

import { SentenceSplitter, toSentences } from '../server/pipeline/sentences'
import { createDeepSeekProvider } from '../server/pipeline/llm'
import { flakyRetry } from '../problems/flaky-retry'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

let failures = 0

function check(ok: boolean, label: string, detail = '') {
  if (ok) console.log(`  ${GREEN}✓${RESET} ${label}${detail ? ` ${DIM}${detail}${RESET}` : ''}`)
  else {
    failures++
    console.log(`  ${RED}✗${RESET} ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** Feeds text one character at a time — the worst case a real stream produces. */
function splitCharByChar(text: string): string[] {
  const splitter = new SentenceSplitter()
  const out: string[] = []
  for (const ch of text) out.push(...splitter.push(ch))
  const tail = splitter.flush()
  if (tail) out.push(tail)
  return out
}

async function main() {
  console.log('\nSentence splitter')

  const two = splitCharByChar('That looks right. What is the complexity?')
  check(two.length === 2, 'splits two sentences', JSON.stringify(two))

  const abbrev = splitCharByChar('Think about O(n) vs. O(n log n) before you commit to it.')
  check(abbrev.length === 1, 'does not split on "vs."', JSON.stringify(abbrev))

  const decimal = splitCharByChar('The delay went from 0.5 to 1.0 seconds there.')
  check(decimal.length === 1, 'does not split inside a decimal', JSON.stringify(decimal))

  const short = splitCharByChar('Right. So what happens on the last attempt?')
  check(short.length === 1, 'keeps a short fragment attached', JSON.stringify(short))

  const quoted = splitCharByChar('You said "it works." Does it though? Let us check.')
  check(quoted.length === 3, 'handles quotes and multiple sentences', String(quoted.length))

  const partial = new SentenceSplitter()
  partial.push('Half a thought')
  check(partial.flush() === 'Half a thought', 'flushes an unterminated tail')

  console.log('\nDeepSeek provider (live)')

  const key = process.env.DEEPSEEK_API_KEY ?? ''
  if (!key) {
    check(false, 'DEEPSEEK_API_KEY present', 'not set — run with `pnpm verify:voice`')
  } else {
    const provider = createDeepSeekProvider(key)

    // Built from a real problem so this exercises a production-sized prefix.
    // DeepSeek grants cache in 128-token blocks, so a hand-written stub prefix is
    // short enough never to cache — the check below would then fail for a reason
    // that has nothing to do with this code.
    const FROZEN = [
      'You are a technical interviewer running a live coding interview.',
      'Speak in one or two short sentences. Never give away the answer; ask questions instead.',
      '',
      `PROBLEM: ${flakyRetry.title}`,
      flakyRetry.statement,
      '',
      'Guidance you must never read aloud:',
      ...flakyRetry.hintLadder.map((hint) => `- ${hint}`),
      ...flakyRetry.followUps.map((question) => `- ask later: ${question}`),
    ].join('\n')

    const started = Date.now()
    let firstSpokenAt: number | null = null
    const sentences: string[] = []

    const { text, usage } = await provider.stream({
      frozenPrefix: FROZEN,
      history: [{ role: 'user', content: 'I think a hash map gets this to O(n). Does that sound right?' }],
      maxTokens: 80,
    })

    const timed = (async function* () {
      for await (const delta of text) {
        firstSpokenAt ??= Date.now() - started
        yield delta
      }
    })()

    for await (const sentence of toSentences(timed)) sentences.push(sentence)

    check(sentences.length > 0, 'streams spoken text', `${sentences.length} sentence(s)`)
    check(
      firstSpokenAt !== null && firstSpokenAt < 3000,
      'first spoken token under 3s',
      `${firstSpokenAt}ms`,
    )
    check(
      !sentences.join(' ').toLowerCase().includes('we need to'),
      'no chain-of-thought leaked into speech',
    )
    console.log(`      ${DIM}said: "${sentences.join(' ').slice(0, 90)}"${RESET}`)

    const used = await usage
    check(used !== null, 'reports usage', used ? `${used.completionTokens} completion tokens` : '')

    // Second identical-prefix turn: the cache should hit from token 0.
    const second = await provider.stream({
      frozenPrefix: FROZEN,
      history: [
        { role: 'user', content: 'I think a hash map gets this to O(n). Does that sound right?' },
        { role: 'assistant', content: sentences.join(' ') },
        { role: 'user', content: 'Right, so I would store the complement as I go.' },
      ],
      maxTokens: 60,
    })
    for await (const _ of second.text) { /* drain */ }
    const secondUsage = await second.usage
    check(
      (secondUsage?.promptCacheHitTokens ?? 0) > 0,
      'prefix cache hits on the follow-up turn',
      `hit ${secondUsage?.promptCacheHitTokens} / miss ${secondUsage?.promptCacheMissTokens}`,
    )

    // Barge-in relies on this: aborting must stop the stream promptly.
    const controller = new AbortController()
    const abortable = await provider.stream({
      frozenPrefix: FROZEN,
      history: [{ role: 'user', content: 'Explain hash maps in detail.' }],
      maxTokens: 400,
      signal: controller.signal,
    })
    let received = 0
    const abortStarted = Date.now()
    try {
      for await (const _ of abortable.text) {
        received++
        if (received === 2) controller.abort()
      }
    } catch {
      // AbortError is the expected outcome.
    }
    check(Date.now() - abortStarted < 5000, 'abort stops the stream', `${Date.now() - abortStarted}ms`)
  }

  console.log(
    failures === 0
      ? `\n${GREEN}Voice pipeline verified against the live API.${RESET}\n`
      : `\n${RED}${failures} check(s) failed.${RESET}\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

void main()
