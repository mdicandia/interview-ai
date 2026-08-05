/**
 * The interviewer's language model, behind a deliberately narrow interface.
 *
 * One implementation today (DeepSeek). The interface exists because the provider
 * choice is the most likely thing to change: it is the slowest stage in the voice
 * pipeline by an order of magnitude, and swapping it should be a one-file edit
 * rather than a refactor.
 *
 * ---------------------------------------------------------------------------
 * Measured on 2026-08-04, not taken from benchmarks:
 *
 *   deepseek-v4-flash, thinking disabled, 6-turn conversation
 *   time to first *spoken* token: min 896ms, median 1127ms, max 1317ms
 *
 * Two findings that shaped this file:
 *
 * 1. V4 is a thinking model by default. It streams `reasoning_content` while
 *    `content` stays null, so the first token the candidate can *hear* arrives
 *    only after the chain of thought finishes — 1500ms rather than 861ms on the
 *    same prompt. An interviewer saying "walk me through that" does not need
 *    chain-of-thought, so the live path disables it.
 *
 * 2. `enable_thinking: false` is silently ignored — no error, and 219 characters
 *    of reasoning still came back. `reasoning_effort: 'minimal'` is worse than
 *    the default (2779ms). Only `thinking: { type: 'disabled' }` actually works.
 *    Do not "simplify" this field.
 *
 * The report path deliberately keeps thinking ON and uses the pro model: it runs
 * after the session, where quality matters and latency does not.
 * ---------------------------------------------------------------------------
 */

export type Role = 'system' | 'user' | 'assistant'

export interface Message {
  role: Role
  content: string
}

export interface StreamOptions {
  /**
   * Byte-identical on every turn. DeepSeek's cache matches only from token 0, so
   * anything volatile here (a timestamp, the current editor contents) turns a
   * ~$0.014/M cache hit into a ~$0.14/M miss. Volatile context belongs in the
   * final user message instead. Measured: 5/5 follow-up turns hit the cache.
   *
   * There is also a *minimum* length, which is easy to trip over while testing.
   * Measured on 2026-08-04, second turn with an identical prefix:
   *
   *     ~27 prompt tokens  -> hit 0    (no cache)
   *     ~69 prompt tokens  -> hit 0    (no cache)
   *    ~153 prompt tokens  -> hit 128  (cached)
   *    ~293 prompt tokens  -> hit 256  (cached)
   *
   * Caching is granted in 128-token blocks, so a prefix shorter than one block
   * never caches at all. A real system prompt plus a problem statement is well
   * past that, but a trimmed-down prefix in a test will silently miss and look
   * like the caching design is broken when it isn't.
   */
  frozenPrefix: string
  history: Message[]
  maxTokens?: number
  /** Aborting mid-stream is how barge-in stops the interviewer talking. */
  signal?: AbortSignal
}

export interface Usage {
  promptCacheHitTokens: number
  promptCacheMissTokens: number
  completionTokens: number
}

export interface StreamResult {
  /** Text the candidate actually hears, token by token. */
  text: AsyncIterable<string>
  /** Resolves once the stream ends. Absent if the request was aborted. */
  usage: Promise<Usage | null>
}

export interface LLMProvider {
  readonly name: string
  /** Low-latency path: what the interviewer says out loud, mid-session. */
  stream(options: StreamOptions): Promise<StreamResult>
  /** Quality path: the post-session report. Latency is irrelevant here. */
  complete(options: {
    messages: Message[]
    maxTokens?: number
    /**
     * Chain-of-thought before answering. **Off by default, deliberately.**
     *
     * `max_tokens` caps reasoning *and* answer together, and reasoning goes
     * first. Asking v4-pro for a two-sentence hint with `max_tokens: 200`
     * returns an empty string: measured `reasoning_tokens: 200`,
     * `finish_reason: 'length'`, 912 characters of thinking, and not one word of
     * answer. Nothing errors — you just get `''`.
     *
     * Turn this on only for genuinely hard, long-form work like the report, and
     * give it a budget with room for both halves.
     */
    thinking?: boolean
    /**
     * Constrains the reply to a single JSON object.
     *
     * The prompt still has to describe the schema — this only guarantees the
     * response parses, not that it has the right keys. Callers must validate.
     */
    json?: boolean
  }): Promise<string>
}

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'

/** Fast model for live conversation; thinking is disabled on this path. */
const LIVE_MODEL = 'deepseek-v4-flash'
/** Stronger model for the report, where a slow, considered answer is fine. */
const REPORT_MODEL = 'deepseek-v4-pro'

interface DeepSeekDelta {
  choices?: { delta?: { content?: string | null; reasoning_content?: string | null } }[]
  usage?: {
    prompt_cache_hit_tokens?: number
    prompt_cache_miss_tokens?: number
    completion_tokens?: number
  }
  error?: { message: string }
}

/** Parses an SSE body into decoded JSON chunks. */
async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<DeepSeekDelta> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let newline: number
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '' || payload === '[DONE]') continue
      try {
        yield JSON.parse(payload) as DeepSeekDelta
      } catch {
        // A partial frame split across reads; the next chunk completes it.
      }
    }
  }
}

export function createDeepSeekProvider(apiKey: string): LLMProvider {
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is not set — add it to .env.local')
  }

  const post = (body: unknown, signal?: AbortSignal) =>
    fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    })

  return {
    name: 'deepseek',

    async stream({ frozenPrefix, history, maxTokens = 120, signal }) {
      const response = await post(
        {
          model: LIVE_MODEL,
          stream: true,
          stream_options: { include_usage: true },
          // See the header comment: this exact shape is the only one that works.
          thinking: { type: 'disabled' },
          max_tokens: maxTokens,
          messages: [{ role: 'system', content: frozenPrefix }, ...history],
        },
        signal,
      )

      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => '')
        // Worth naming explicitly: an unfunded account returns a perfectly valid
        // key and a 200 from /models, so this is otherwise baffling.
        if (detail.includes('Insufficient Balance')) {
          throw new Error(
            'DeepSeek rejected the request: insufficient balance. The key is valid; ' +
              'the account needs credit at https://platform.deepseek.com',
          )
        }
        throw new Error(`DeepSeek ${response.status}: ${detail.slice(0, 200)}`)
      }

      let resolveUsage: (usage: Usage | null) => void
      const usage = new Promise<Usage | null>((resolve) => {
        resolveUsage = resolve
      })

      async function* text(): AsyncGenerator<string> {
        let seen: Usage | null = null
        try {
          for await (const chunk of readSse(response.body!)) {
            if (chunk.error) throw new Error(`DeepSeek: ${chunk.error.message}`)
            if (chunk.usage) {
              seen = {
                promptCacheHitTokens: chunk.usage.prompt_cache_hit_tokens ?? 0,
                promptCacheMissTokens: chunk.usage.prompt_cache_miss_tokens ?? 0,
                completionTokens: chunk.usage.completion_tokens ?? 0,
              }
            }
            // `reasoning_content` is deliberately dropped rather than spoken.
            // With thinking disabled it should never appear; if a future model
            // default changes, this keeps internal monologue out of the audio.
            const delta = chunk.choices?.[0]?.delta?.content
            if (delta) yield delta
          }
        } finally {
          resolveUsage(seen)
        }
      }

      return { text: text(), usage }
    },

    async complete({ messages, maxTokens = 4000, thinking = false, json: jsonMode = false }) {
      const response = await post({
        model: REPORT_MODEL,
        stream: false,
        max_tokens: maxTokens,
        ...(thinking ? {} : { thinking: { type: 'disabled' } }),
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        messages,
      })
      if (!response.ok) {
        throw new Error(`DeepSeek ${response.status}: ${(await response.text()).slice(0, 200)}`)
      }
      const json = (await response.json()) as {
        choices?: {
          message?: { content?: string }
          finish_reason?: string
        }[]
        usage?: { completion_tokens_details?: { reasoning_tokens?: number } }
      }

      const choice = json.choices?.[0]
      const content = choice?.message?.content ?? ''

      // Fail loudly rather than returning an empty string. The overwhelmingly
      // likely cause is the token budget being eaten by reasoning, and a silent
      // '' is very hard to trace back to that.
      if (content.trim() === '') {
        const reasoned = json.usage?.completion_tokens_details?.reasoning_tokens ?? 0
        throw new Error(
          `DeepSeek returned no content (finish_reason: ${choice?.finish_reason ?? 'unknown'}` +
            (reasoned > 0 ? `, ${reasoned} tokens spent reasoning` : '') +
            '). Raise maxTokens, or leave `thinking` off.',
        )
      }

      return content
    },
  }
}
