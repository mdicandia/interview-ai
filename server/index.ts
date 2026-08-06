import { WebSocketServer, type WebSocket } from 'ws'
import { getProblem } from '@/problems'
import { createDeepSeekProvider } from './pipeline/llm'
import { InterviewSession } from './interview/orchestrator'
import { isClientMessage, type ClientMessage, type ServerMessage } from './protocol'

/**
 * The voice server. A separate Node process from Next.js, deliberately.
 *
 * Next.js route handlers cannot hold a long-lived WebSocket, and this connection
 * lives for the length of an interview. Running it standalone also keeps the
 * realtime path — where a blocked event loop is audible — away from React
 * rendering and HMR.
 *
 *   pnpm dev        UI on :3000 and this on :8787, together
 *   pnpm dev:voice  just this, for working on the pipeline alone
 */

const PORT = Number(process.env.VOICE_SERVER_PORT ?? 8787)

function requireKey(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(
      `\n  ${name} is not set.\n` +
        `  Add it to .env.local — see .env.example for where to get one.\n`,
    )
    process.exit(1)
  }
  return value
}

const deepseekKey = requireKey('DEEPSEEK_API_KEY')
const deepgramKey = requireKey('DEEPGRAM_API_KEY')
const cartesiaKey = requireKey('CARTESIA_API_KEY')

const llm = createDeepSeekProvider(deepseekKey)
const server = new WebSocketServer({ port: PORT })

server.on('connection', (socket: WebSocket) => {
  let session: InterviewSession | null = null

  /**
   * Resolves once `start` has finished. Every other message waits on it.
   *
   * Messages are handled without awaiting each other, so a `code` or
   * `test-results` frame arriving while the session is still connecting to
   * Deepgram and Cartesia would otherwise be processed against a half-built
   * session — observed in testing as a `state` message overtaking `ready`, with
   * the interviewer replying before it had announced it was listening. The
   * browser client happens to wait for `ready` before sending anything, but the
   * server should not depend on the client being polite.
   */
  let started: Promise<void> = Promise.resolve()

  const send = (message: ServerMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
  }
  const sendAudio = (pcm: Buffer) => {
    if (socket.readyState === socket.OPEN) socket.send(pcm, { binary: true })
  }

  const fail = (message: string) => {
    console.error(`[voice] ${message}`)
    send({ type: 'error', message, fatal: true })
  }

  socket.on('message', (data, isBinary) => {
    // Binary frames are microphone audio; text frames are control messages.
    // See server/protocol.ts for why the split works this way.
    if (isBinary) {
      session?.pushAudio(data as Buffer)
      return
    }

    let message: ClientMessage
    try {
      const parsed: unknown = JSON.parse(data.toString())
      if (!isClientMessage(parsed)) return
      message = parsed
    } catch {
      return
    }

    void handle(message)
  })

  async function handle(message: ClientMessage) {
    // Anything that touches the session must wait for it to exist.
    if (message.type !== 'start') await started

    switch (message.type) {
      case 'start': {
        if (session) return
        const problem = getProblem(message.problemSlug)
        if (!problem) {
          fail(`Unknown problem: ${message.problemSlug}`)
          return
        }

        let markStarted: () => void
        started = new Promise<void>((resolve) => {
          markStarted = resolve
        })

        try {
          session = new InterviewSession({
            problem,
            language: message.language,
            llm,
            deepgramKey,
            cartesiaKey,
            send,
            sendAudio,
          })
          await session.start()
          console.log(`[voice] session started: ${problem.slug} (${message.language})`)
        } catch (error) {
          session = null
          fail(error instanceof Error ? error.message : String(error))
        } finally {
          markStarted!()
        }
        break
      }

      case 'code':
        session?.updateCode(message.files, message.activePath)
        break

      case 'test-results':
        session?.updateTests({
          passed: message.passed,
          total: message.total,
          failing: message.failing,
          compileError: message.compileError,
        })
        break

      case 'hint-taken':
        session?.noteHint(message.level, message.text)
        break

      case 'mic':
        // The browser gates its own microphone; nothing to do server-side yet.
        break

      case 'end':
        reportUsage()
        await session?.end()
        session = null
        break
    }
  }

  /**
   * Prints what the session cost on the way out.
   *
   * Both figures are metered by a third party and neither is visible anywhere
   * else. Deepgram's is the surprising one — it counts the microphone being
   * open, not you talking — so it is the number worth watching.
   */
  function reportUsage() {
    if (!session) return
    const { spokenCharacters, listenedSeconds } = session.usage()
    const minutes = listenedSeconds / 60
    console.log(
      `[voice] session used ~${spokenCharacters} TTS characters and ` +
        `${minutes.toFixed(1)} min of streamed audio (≈ $${(minutes * 0.0048).toFixed(3)} Deepgram)`,
    )
  }

  socket.on('close', () => {
    reportUsage()
    void session?.end()
    session = null
  })

  socket.on('error', (error) => {
    console.error('[voice] socket error:', error.message)
  })
})

console.log(`[voice] listening on ws://localhost:${PORT}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
