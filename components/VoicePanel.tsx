'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Language } from '@/lib/problems/types'
import {
  VoiceClient,
  type Observation,
  type RoundOutcome,
  type TranscriptLine,
  type VoiceSnapshot,
} from '@/lib/client/voice'
import type { TurnState } from '@/server/protocol'
import { resumableTranscript } from '@/lib/session/record'

const VOICE_URL = process.env.NEXT_PUBLIC_VOICE_SERVER_URL ?? 'ws://localhost:8787'

/*
 * Labels say whose move it is, not what the machine is doing internally.
 *
 * "Listening" for an idle turn was actively misleading with push-to-talk — the
 * microphone is closed, and the interviewer is waiting for you to open it. Being
 * out of sync about whose turn it is was the single most confusing thing about
 * talking to this.
 */
const TURN_LABEL: Record<TurnState, string> = {
  idle: 'Your turn',
  listening: 'Hearing you',
  thinking: 'Thinking…',
  speaking: 'Speaking',
}

const TURN_HINT: Record<TurnState, string> = {
  idle: 'Hold to talk when you are ready',
  listening: 'Release when you have finished the thought',
  thinking: 'Composing a reply — it will speak in a moment',
  speaking: 'Hold to talk if you want to cut in',
}

const TURN_COLOR: Record<TurnState, string> = {
  idle: 'bg-ink-2',
  listening: 'bg-pass',
  thinking: 'bg-warn',
  speaking: 'bg-accent',
}

export interface VoicePanelProps {
  problemSlug: string
  language: Language
  /** Latest editor contents, pushed to the interviewer as they change. */
  files: { path: string; content: string }[]
  activePath: string
  /** Called when the interviewer asks for the tests to be run. */
  onRunTests: () => void
  clientRef?: (client: VoiceClient | null) => void
  /** Settled transcript, for the post-session report. Interim lines are excluded. */
  onTranscript?: (lines: TranscriptLine[]) => void
  /**
   * Moments the interviewer flagged. Passed straight to the record and never
   * rendered — see the note on `VoiceSnapshot.observations`.
   */
  onObservations?: (observations: Observation[]) => void
  /** Live coverage of the round's expected points. Spoken rounds only. */
  onObjectives?: (objectives: { covered: number[]; total: number; essential: number }) => void
  /** Fires once, when the interviewer ends the round. */
  onComplete?: (outcome: RoundOutcome) => void
}

export function VoicePanel({
  problemSlug,
  language,
  files,
  activePath,
  onRunTests,
  clientRef,
  onTranscript,
  onObservations,
  onObjectives,
  onComplete,
}: VoicePanelProps) {
  const ref = useRef<VoiceClient | null>(null)
  const getClient = () => (ref.current ??= new VoiceClient())
  const client = getClient()

  // useSyncExternalStore rather than useState: audio frames and transcript
  // updates arrive far too often to route through component state without
  // re-rendering the editor on every one.
  const snapshot = useSyncExternalStore<VoiceSnapshot>(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  )

  useEffect(() => {
    client.onRunTests(onRunTests)
  }, [client, onRunTests])

  useEffect(() => {
    clientRef?.(client)
    return () => clientRef?.(null)
  }, [client, clientRef])

  // Only final lines reach the record. An interim line is a guess that will be
  // replaced, and a report quoting one would be citing something never said.
  useEffect(() => {
    if (!onTranscript) return
    const final = snapshot.transcript.filter((line) => line.final)
    if (final.length > 0) onTranscript(final)
  }, [onTranscript, snapshot.transcript])

  useEffect(() => {
    if (snapshot.observations.length > 0) onObservations?.(snapshot.observations)
  }, [onObservations, snapshot.observations])

  useEffect(() => {
    if (snapshot.objectives) onObjectives?.(snapshot.objectives)
  }, [onObjectives, snapshot.objectives])

  useEffect(() => {
    if (snapshot.outcome) onComplete?.(snapshot.outcome)
  }, [onComplete, snapshot.outcome])

  // Push the code to the interviewer, debounced. It only needs to be roughly
  // current — a keystroke-accurate view would mean a message per character.
  useEffect(() => {
    if (snapshot.status !== 'live') return
    const timer = setTimeout(() => client.sendCode(files, activePath), 400)
    return () => clearTimeout(timer)
  }, [client, files, activePath, snapshot.status])

  useEffect(() => {
    return () => {
      void ref.current?.disconnect()
      ref.current = null
    }
  }, [])

  const live = snapshot.status === 'live'
  const connecting = snapshot.status === 'connecting'
  /** No files means no editor, which means this is a spoken round. */
  const spoken = files.length === 0

  /*
   * Hold to talk, on the button or on the spacebar.
   *
   * Every release goes through `talk`, which tracks whether we are actually
   * holding. That bookkeeping is the whole point: the release path must not
   * re-test any of the conditions the press path used, because they can change
   * while the key is down. Guarding keyup on "is the editor focused" meant that
   * pressing space outside the editor and then clicking into it before letting
   * go never released the microphone at all — the turn never ended and the
   * interviewer never answered.
   */
  /*
   * How many transcript lines came from an earlier connection.
   *
   * Read from the evidence record at the moment Start is pressed rather than
   * held as state: a round can be left and re-entered, and the record is the
   * only thing that knows what happened while this component was unmounted.
   */
  const [resumedLines, setResumedLines] = useState(0)
  const start = useCallback(() => {
    const resume = resumableTranscript(problemSlug)
    setResumedLines(resume.length)
    void client.connect({ url: VOICE_URL, problemSlug, language, resume })
  }, [client, problemSlug, language])

  const holding = useRef(false)
  const talk = useCallback(
    (next: boolean) => {
      if (holding.current === next) return
      holding.current = next
      client.setTalking(next)
    },
    [client],
  )

  useEffect(() => {
    if (!live) return

    // Only consulted when *starting*. Typing a space in the editor must not open
    // the microphone; releasing it must always close one that is open.
    const typing = () => {
      const active = document.activeElement
      return (
        active instanceof HTMLElement &&
        (active.isContentEditable || active.closest('.cm-editor') !== null)
      )
    }

    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || typing()) return
      event.preventDefault()
      talk(true)
    }
    const up = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !holding.current) return
      event.preventDefault()
      talk(false)
    }
    // Releasing outside the window would otherwise leave the microphone open.
    // Only when actually holding: an ordinary tab-away must not be read as the
    // end of a turn, which would cut the interviewer off mid-sentence.
    const blur = () => talk(false)

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      // Unmounting mid-hold would strand the microphone open too.
      talk(false)
    }
  }, [live, talk])

  return (
    <section className="flex h-full min-h-0 flex-col border-l border-surface-3 bg-surface-1">
      <header className="flex shrink-0 items-center gap-2 border-b border-surface-3 px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
          Interviewer
        </h2>
        {live && (
          <span className="flex items-center gap-1.5">
            <span
              className={`size-2 rounded-full ${TURN_COLOR[snapshot.turn]} ${
                snapshot.turn === 'speaking' || snapshot.turn === 'thinking'
                  ? 'animate-pulse'
                  : ''
              }`}
            />
            <span className="text-[11px] font-medium text-ink-0">
              {TURN_LABEL[snapshot.turn]}
            </span>
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            disabled={connecting}
            onClick={() => {
              if (live) void client.disconnect()
              else start()
            }}
            className={`rounded px-2.5 py-0.5 text-[11px] font-medium transition-opacity hover:opacity-90 disabled:opacity-50 ${
              live ? 'bg-surface-3 text-ink-0' : 'bg-accent text-surface-0'
            }`}
          >
            {connecting ? 'Connecting…' : live ? 'End' : 'Start interview'}
          </button>
        </div>
      </header>

      {snapshot.error && (
        <p className="shrink-0 border-b border-surface-3 bg-fail/10 px-3 py-2 text-[11.5px] leading-relaxed text-fail">
          {snapshot.error}
        </p>
      )}

      {live && snapshot.objectives && !snapshot.outcome && (
        <div className="shrink-0 border-b border-surface-3 px-3 py-2">
          <div className="mb-1.5 flex items-baseline gap-2">
            <span className="text-[10px] uppercase tracking-wider text-ink-2">Objectives</span>
            <span className="ml-auto text-[11px] tabular-nums text-ink-1">
              {snapshot.objectives.covered.length} of {snapshot.objectives.total}
            </span>
          </div>
          {/*
            Pips, not labels. What each point *is* stays hidden until the round
            ends — showing the list would hand over the answer to the question
            being asked. Seeing the count move is the feedback that matters.
          */}
          <div className="flex gap-1">
            {Array.from({ length: snapshot.objectives.total }, (_, i) => (
              <span
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  snapshot.objectives!.covered.includes(i + 1)
                    ? i < snapshot.objectives!.essential
                      ? 'bg-pass'
                      : 'bg-accent'
                    : 'bg-surface-3'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {snapshot.outcome && (
        <div className="shrink-0 border-b border-surface-3 bg-surface-2 px-3 py-3">
          <div className="mb-1.5 flex items-baseline gap-2">
            <span className="text-[10px] uppercase tracking-wider text-accent">
              Interview finished
            </span>
            <span
              className={`ml-auto rounded border px-1.5 py-px text-[10px] uppercase tracking-wide ${
                snapshot.outcome.verdict === 'strong' || snapshot.outcome.verdict === 'solid'
                  ? 'border-pass/50 text-pass'
                  : snapshot.outcome.verdict === 'mixed'
                    ? 'border-warn/50 text-warn'
                    : 'border-fail/50 text-fail'
              }`}
            >
              {snapshot.outcome.verdict}
            </span>
          </div>
          <p className="mb-2.5 text-[12.5px] leading-relaxed text-ink-0">
            {snapshot.outcome.summary}
          </p>
          {/*
            The route to the report, offered at the only moment it is obvious you
            want one. Previously a finished interview just stopped, and the report
            was reachable only by pressing "End & get report" on the session bar —
            so a whole round could be talked through and never reported back.
          */}
          <a
            href="/report"
            className="mb-3 inline-block rounded bg-accent px-3 py-1.5 text-[12px] font-medium text-surface-0 transition-opacity hover:opacity-90"
          >
            See the full report
          </a>
          {/* Revealed only now. The round is over, so what you missed is feedback. */}
          <ul className="flex flex-col gap-1">
            {snapshot.outcome.points.map((point, i) => {
              const hit = snapshot.outcome!.covered.includes(i + 1)
              return (
                <li key={i} className="flex gap-2 text-[12px] leading-relaxed">
                  <span className={hit ? 'text-pass' : 'text-ink-2'}>{hit ? '✓' : '○'}</span>
                  <span className={hit ? 'text-ink-1' : 'text-ink-2'}>
                    {point.text}
                    {!point.essential && <span className="text-ink-2"> (bonus)</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {live && (
        <div className="shrink-0 border-b border-surface-3 px-3 py-2.5">
          {/*
            Hold to talk, rather than the interviewer guessing from silence when
            a thought has finished. A pause to read a line is indistinguishable
            from the end of a sentence, so guessing meant being interrupted
            exactly while concentrating.
          */}
          <button
            type="button"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              talk(true)
            }}
            onPointerUp={() => talk(false)}
            onPointerCancel={() => talk(false)}
            className={`w-full rounded-md border px-3 py-2 text-[12px] font-medium transition-colors ${
              snapshot.holding
                ? 'border-pass bg-pass/15 text-pass'
                : 'border-surface-3 text-ink-1 hover:border-accent-dim hover:text-ink-0'
            }`}
          >
            {snapshot.holding ? 'Listening — release when done' : 'Hold to talk'}
          </button>
          <p className="mt-1.5 text-center text-[10.5px] text-ink-2">
            {snapshot.turn === 'idle' || snapshot.holding
              ? TURN_HINT[snapshot.turn]
              : TURN_HINT[snapshot.turn]}
          </p>
          <p className="mt-1 text-center text-[10px] text-ink-2/70">
            or hold <kbd className="rounded border border-surface-3 px-1">space</kbd> outside
            the editor
          </p>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        {snapshot.transcript.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-ink-2">
            {live
              ? 'Hold the button and talk. The interviewer waits until you let go, so pauses are yours to take.'
              : spoken
                ? 'Press Start interview. It will ask the question, then wait for your answer.'
                : 'Press Start interview. The interviewer will hear you and can see your code as you write it.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {snapshot.transcript.map((line, i) => (
              <li key={i}>
                {/*
                  The seam. Without it a resumed round opens with a wall of text
                  you have no memory of having just said, and no way to tell what
                  is from before the break.
                */}
                {live && resumedLines > 0 && i === resumedLines && (
                  <div className="mb-2.5 flex items-center gap-2">
                    <span className="h-px flex-1 bg-surface-3" />
                    <span className="text-[10px] uppercase tracking-wide text-ink-2">
                      Resumed
                    </span>
                    <span className="h-px flex-1 bg-surface-3" />
                  </div>
                )}
                <div className="text-[10px] uppercase tracking-wide text-ink-2">
                  {line.role === 'interviewer' ? 'Interviewer' : 'You'}
                </div>
                <p
                  className={`text-[12.5px] leading-relaxed ${
                    line.final ? 'text-ink-0' : 'text-ink-2 italic'
                  }`}
                >
                  {line.text}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
