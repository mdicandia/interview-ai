import type { Language } from '@/lib/problems/types'

/**
 * The wire protocol between the browser and the voice server.
 *
 * One socket carries both directions and both kinds of payload. WebSocket frames
 * are already typed as text or binary, so that distinction does the routing:
 *
 *   text frame   -> JSON control message (these types)
 *   binary frame -> raw PCM16 @ 16kHz mono
 *
 * No envelope around the audio, no base64. Audio is by far the highest-volume
 * traffic here — 50 frames a second in each direction — and wrapping every frame
 * in JSON would cost bandwidth and CPU for nothing.
 */

export const AUDIO_SAMPLE_RATE = 16_000

/** How much audio the browser sends per frame. 20ms is the usual streaming unit. */
export const FRAME_MS = 20

/* ------------------------------------------------------------ client → server */

export type ClientMessage =
  /** Open a session. Sent once, before any audio. */
  | { type: 'start'; problemSlug: string; language: Language }
  /**
   * Latest editor contents, debounced. The interviewer needs to see the code to
   * ask about it, but this is volatile and must never enter the cached prefix.
   */
  | { type: 'code'; files: { path: string; content: string }[]; activePath: string }
  /** Results of a test run, so the interviewer can react to what happened. */
  | {
      type: 'test-results'
      passed: number
      total: number
      failing: string[]
      compileError?: string
    }
  /**
   * The candidate started or stopped talking, as decided by the browser's own
   * mic gate. The server also gets voice activity from Deepgram; this is the
   * faster local signal for muting.
   */
  | { type: 'mic'; enabled: boolean }
  /**
   * The candidate took a text hint. Told to the interviewer so it doesn't
   * re-offer the same nudge, and so the report can weigh it — asking for help is
   * a signal a real interviewer would remember.
   */
  | { type: 'hint-taken'; level: number; text: string }
  /** End the session and generate the report. */
  | { type: 'end' }

/* ------------------------------------------------------------ server → client */

/**
 * Where the conversation currently is. Drives the mic indicator, and tells the
 * browser whether incoming audio should be played or dropped.
 */
export type TurnState =
  /** Nobody is talking. */
  | 'idle'
  /** The candidate is speaking; audio is being transcribed. */
  | 'listening'
  /** Endpointing fired; the model is composing a reply. Backchannel plays here. */
  | 'thinking'
  /** The interviewer is speaking. Barge-in is armed. */
  | 'speaking'

export type ServerMessage =
  /** Session is up; the pipeline is connected and audio may start flowing. */
  | { type: 'ready'; greeting?: string }
  | { type: 'state'; turn: TurnState }
  /**
   * Transcript line. `final: false` lines are interim guesses that will be
   * replaced — useful to show live, useless to act on.
   */
  | { type: 'transcript'; role: 'candidate' | 'interviewer'; text: string; final: boolean }
  /**
   * Barge-in. The browser must drop every buffered sample immediately.
   *
   * Cancelling on the server only stops *new* audio being sent. Whatever already
   * crossed the wire is sitting in the playback queue, and without this the
   * interviewer keeps talking for a second after being interrupted — the single
   * most immersion-breaking failure this pipeline has.
   */
  | { type: 'flush-audio' }
  /** The interviewer asked to run the tests. The browser owns execution. */
  | { type: 'run-tests' }
  /** Session finished; the report is ready. */
  | { type: 'report'; markdown: string }
  | { type: 'error'; message: string; fatal: boolean }

/** Type guards, so the socket handlers don't hand-roll `in` checks. */
export function isClientMessage(value: unknown): value is ClientMessage {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
}
