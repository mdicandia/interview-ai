'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { Language } from '@/lib/problems/types'
import {
  VoiceClient,
  type Observation,
  type TranscriptLine,
  type VoiceSnapshot,
} from '@/lib/client/voice'
import type { TurnState } from '@/server/protocol'

const VOICE_URL = process.env.NEXT_PUBLIC_VOICE_SERVER_URL ?? 'ws://localhost:8787'

const TURN_LABEL: Record<TurnState, string> = {
  idle: 'Listening',
  listening: 'Hearing you',
  thinking: 'Thinking',
  speaking: 'Speaking',
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

  return (
    <section className="flex h-full min-h-0 flex-col border-l border-surface-3 bg-surface-1">
      <header className="flex shrink-0 items-center gap-2 border-b border-surface-3 px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
          Interviewer
        </h2>
        {live && (
          <span className="flex items-center gap-1.5">
            <span
              className={`size-1.5 rounded-full ${TURN_COLOR[snapshot.turn]} ${
                snapshot.turn === 'speaking' || snapshot.turn === 'listening'
                  ? 'animate-pulse'
                  : ''
              }`}
            />
            <span className="text-[11px] text-ink-1">{TURN_LABEL[snapshot.turn]}</span>
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {live && (
            <button
              type="button"
              onClick={() => client.toggleMute()}
              className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
                snapshot.muted
                  ? 'border-fail/50 text-fail'
                  : 'border-surface-3 text-ink-2 hover:text-ink-0'
              }`}
            >
              {snapshot.muted ? 'Unmute' : 'Mute'}
            </button>
          )}
          <button
            type="button"
            disabled={connecting}
            onClick={() => {
              if (live) void client.disconnect()
              else void client.connect({ url: VOICE_URL, problemSlug, language })
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

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        {snapshot.transcript.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-ink-2">
            {live
              ? 'Say hello, or just start talking through the problem.'
              : 'Press Start interview. The interviewer will hear you and can see your code as you write it.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {snapshot.transcript.map((line, i) => (
              <li key={i}>
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
