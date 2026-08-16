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

/**
 * Microphone audio, browser → server. Deepgram's rate.
 *
 * The capture worklet resamples from whatever the AudioContext is running at
 * down to this, so it is independent of the playback rate below.
 */
export const AUDIO_SAMPLE_RATE = 16_000

/**
 * Interviewer audio, server → browser. **Deliberately not the same rate.**
 *
 * The two directions have different masters. Deepgram wants 16kHz and gains
 * nothing from more. Kokoro, the local speech model, emits 24kHz natively — and
 * every resample is either quality lost or filter code to get wrong, on a path
 * that is already the CPU-heaviest thing the server does.
 *
 * So the playback half runs at the model's rate and nothing converts. Cartesia
 * is asked for 24kHz too, so swapping providers does not change the wire format.
 */
export const PLAYBACK_SAMPLE_RATE = 24_000

/** How much audio the browser sends per frame. 20ms is the usual streaming unit. */
export const FRAME_MS = 20

/* ------------------------------------------------------------ client → server */

export type ClientMessage =
  /**
   * Open a session. Sent once, before any audio.
   *
   * `resume` carries what was already said, when the round is being picked up
   * after a pause or a reload. Nothing on the voice server survives a
   * disconnect — the conversation history, the coverage tally and the closing
   * verdict all live in one process — but the browser has been writing every
   * settled line to its evidence record throughout. So the transcript comes back
   * up the wire and the rest is rebuilt from it.
   */
  | {
      type: 'start'
      problemSlug: string
      language: Language
      resume?: { role: 'candidate' | 'interviewer'; text: string; at: number }[]
    }
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
   * Push-to-talk. The candidate holds a key or button while speaking.
   *
   * When this is in use the server stops trusting Deepgram's endpointing to
   * decide when a turn ended, and waits for `holding: false` instead. Silence is
   * a terrible signal for "I have finished my thought" while someone is working
   * through a problem: pausing to read a line is indistinguishable from
   * finishing a sentence, so the interviewer talks over you exactly when you are
   * concentrating hardest.
   */
  | { type: 'talk'; holding: boolean }
  /**
   * The candidate took a text hint. Told to the interviewer so it doesn't
   * re-offer the same nudge, and so the report can weigh it — asking for help is
   * a signal a real interviewer would remember.
   */
  | { type: 'hint-taken'; level: number; text: string }
  /** Close the session. The report is generated separately, over HTTP. */
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
  /**
   * Session is up; the pipeline is connected and audio may start flowing.
   *
   * Carried a `greeting` field for a while that nothing ever set and nothing
   * ever rendered — a stub for the opening turn, which is now a real spoken turn
   * from the interviewer rather than a string on this message.
   */
  | { type: 'ready' }
  | { type: 'state'; turn: TurnState }
  /**
   * Transcript line. `final: false` lines are interim guesses that will be
   * replaced — useful to show live, useless to act on.
   */
  | {
      type: 'transcript'
      role: 'candidate' | 'interviewer'
      text: string
      final: boolean
      /**
       * Where this sat in the audio, in seconds, and how long it took to say.
       *
       * Candidate lines only, and only on final ones. Present so the report can
       * measure pace and silence against the clock the speaker was actually on:
       * the wall-clock arrival time of a transcript includes the model's own
       * latency and the endpointing window, which is a property of the pipeline
       * rather than of the person.
       */
      start?: number
      spokenSeconds?: number
    }
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
  /**
   * A moment the interviewer flagged for the report, via `note_observation`.
   *
   * Never shown to the candidate mid-round — seeing "concern: could not justify
   * that choice" appear live would change how they behave for the rest of the
   * session, which is the opposite of what a practice run is for. It goes
   * straight into the evidence record and surfaces only in the report.
   */
  /**
   * One of the round's expected points has been reached.
   *
   * Only the index and the totals cross the wire while the round is running.
   * Sending the text would put the answer key on screen mid-question, which is
   * the one thing a spoken round cannot afford.
   */
  | { type: 'objective'; covered: number[]; total: number; essential: number }
  /**
   * The interviewer has ended the round.
   *
   * The points are revealed here, and only here — the round is over, so seeing
   * what you missed is the feedback rather than a leak.
   */
  | {
      type: 'round-complete'
      verdict: 'strong' | 'solid' | 'mixed' | 'weak'
      summary: string
      covered: number[]
      points: { text: string; essential: boolean }[]
    }
  | {
      type: 'observation'
      note: string
      axis: 'content' | 'delivery'
      significance: 'strength' | 'concern'
      at: number
    }
  /*
   * There is deliberately no 'report' message.
   *
   * The report is a POST to /api/report, built from an evidence record the
   * browser accumulates — see lib/session/record.ts. It has to work for a session
   * done in silence with no microphone, which is exactly the case a socket-borne
   * report cannot serve, because the socket was never opened.
   */
  | { type: 'error'; message: string; fatal: boolean }

/** Type guards, so the socket handlers don't hand-roll `in` checks. */
export function isClientMessage(value: unknown): value is ClientMessage {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
}
