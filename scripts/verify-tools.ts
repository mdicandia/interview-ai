/**
 * The tool-dispatch paths, against a stubbed model. No network, deterministic.
 *
 * `verify:server` proves the interviewer *chooses* to use its tools against the
 * real API, but it cannot prove the machinery is correct, because whether a tool
 * fires at all is the model's discretion and it varies run to run. Measured with
 * an identical prompt across three runs, `note_observation` fired on 1 of 5
 * turns, then 0, then 0. Asserting on that is asserting on the model's mood.
 *
 * So the two are split. This file pins the behaviour that must never break:
 * silent tool calls get a follow-up so the turn is not mute, a spoken turn does
 * not pay for a second generation, malformed arguments are survivable, and the
 * loop is bounded. `verify:server` reports the live usage rate as information.
 *
 * No STT or TTS client is created — `start()` is never called, and the
 * orchestrator's `#tts?.` optional chaining means the turn machinery runs
 * without them.
 *
 * Run with: pnpm verify:tools
 */

import { getProblem } from '../problems'
import { InterviewSession } from '../server/interview/orchestrator'
import type { LLMProvider, StreamResult, ToolCall } from '../server/pipeline/llm'
import type { ServerMessage } from '../server/protocol'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

let failures = 0
function check(ok: boolean, label: string, detail = '') {
  if (ok) console.log(`  ${GREEN}✓${RESET} ${label}${detail ? ` ${DIM}${detail}${RESET}` : ''}`)
  else {
    failures += 1
    console.log(`  ${RED}✗${RESET} ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One scripted generation: what it says, and what it asks for. */
interface Pass {
  text: string
  calls?: ToolCall[]
}

/** Replays `passes` in order, one per `stream()` call, and counts the calls. */
function stubLLM(passes: Pass[]): LLMProvider & { passesUsed: () => number } {
  let index = 0
  return {
    name: 'stub',
    passesUsed: () => index,
    async stream(): Promise<StreamResult> {
      // Past the end means the orchestrator asked for more generations than the
      // scenario allows — silence rather than a throw, so the bound is visible
      // as a count instead of an exception from somewhere unrelated.
      const pass = passes[index] ?? { text: '' }
      index += 1
      async function* text() {
        if (pass.text) yield pass.text
      }
      return {
        text: text(),
        usage: Promise.resolve(null),
        toolCalls: Promise.resolve(pass.calls ?? []),
      }
    },
    async complete() {
      return ''
    },
  }
}

function session(llm: LLMProvider) {
  const sent: ServerMessage[] = []
  const problem = getProblem('flaky-retry')
  if (!problem) throw new Error('flaky-retry is missing')

  const instance = new InterviewSession({
    problem,
    language: 'python',
    llm,
    deepgramKey: 'unused',
    cartesiaKey: 'unused',
    send: (message) => sent.push(message),
    sendAudio: () => {},
  })
  return { instance, sent }
}

/** `updateTests` is the one public entry point that starts a turn. */
async function turn(instance: InterviewSession, settleMs = 60) {
  instance.updateTests({ passed: 2, total: 5, failing: ['test_backoff_is_exponential'] })
  await sleep(settleMs)
}

const spokenIn = (sent: ServerMessage[]) =>
  sent
    .filter((m): m is Extract<ServerMessage, { type: 'transcript' }> => m.type === 'transcript')
    .filter((m) => m.role === 'interviewer')
    .map((m) => m.text)
    .join(' ')

const call = (name: string, args: string, id = `call-${name}`): ToolCall => ({
  id,
  name,
  arguments: args,
})

async function main() {
  console.log('\nSpoken turn that also takes a note')
  {
    const llm = stubLLM([
      {
        text: 'That assumption is worth checking.',
        calls: [
          call(
            'note_observation',
            '{"note":"Assumed the test was wrong rather than the code.","axis":"content","significance":"concern"}',
          ),
        ],
      },
    ])
    const { instance, sent } = session(llm)
    await turn(instance)

    const observations = sent.filter((m) => m.type === 'observation')
    check(observations.length === 1, 'sends the observation to the browser')
    check(
      observations[0]?.type === 'observation' && observations[0].axis === 'content',
      'carries the axis through',
      observations[0]?.type === 'observation' ? observations[0].note : '',
    )
    check(instance.observations.length === 1, 'keeps it server-side for the report')
    check(spokenIn(sent).includes('worth checking'), 'still says its reply')
    // The whole point of the "speak and note together" shape: no second
    // generation, so the turn costs exactly what an ordinary one costs.
    check(llm.passesUsed() === 1, 'does not pay for a second generation', `${llm.passesUsed()} pass`)
  }

  console.log('\nSilent tool call')
  {
    const llm = stubLLM([
      { text: '', calls: [call('run_tests', '{}')] },
      { text: "Let's see what that gives us." },
    ])
    const { instance, sent } = session(llm)
    await turn(instance)

    check(sent.some((m) => m.type === 'run-tests'), 'asks the browser to run the tests')
    // Without the follow-up the turn produces no audio at all and the state
    // machine sits in `thinking` for the rest of the session.
    check(llm.passesUsed() === 2, 'generates again so the turn is not mute', `${llm.passesUsed()} passes`)
    check(spokenIn(sent).includes('what that gives us'), 'speaks on the follow-up')
    check(
      sent.some((m) => m.type === 'state' && m.turn === 'thinking'),
      'passes through thinking',
    )
  }

  console.log('\nMalformed tool arguments')
  {
    const llm = stubLLM([
      { text: 'Go on.', calls: [call('note_observation', '{"note": "truncated mid-str')] },
    ])
    const { instance, sent } = session(llm)
    await turn(instance)

    check(sent.filter((m) => m.type === 'observation').length === 0, 'records nothing from a broken call')
    check(instance.observations.length === 0, 'and nothing server-side')
    check(spokenIn(sent).includes('Go on'), 'the turn still completes')
    check(!sent.some((m) => m.type === 'error'), 'does not surface an error to the candidate')
  }

  console.log('\nUnknown tool')
  {
    const llm = stubLLM([
      { text: '', calls: [call('end_interview', '{}')] },
      { text: 'Carrying on.' },
    ])
    const { instance, sent } = session(llm)
    await turn(instance)
    check(spokenIn(sent).includes('Carrying on'), 'ignores it and keeps going')
    check(!sent.some((m) => m.type === 'error'), 'does not surface an error to the candidate')
  }

  console.log('\nRepeated silent calls are bounded')
  {
    // A model that answers every follow-up with another silent tool call would
    // otherwise loop forever, one paid generation at a time.
    const llm = stubLLM([
      { text: '', calls: [call('note_observation', '{"note":"a","axis":"content","significance":"concern"}', 'c1')] },
      { text: '', calls: [call('note_observation', '{"note":"b","axis":"content","significance":"concern"}', 'c2')] },
      { text: '', calls: [call('note_observation', '{"note":"c","axis":"content","significance":"concern"}', 'c3')] },
    ])
    const { instance, sent } = session(llm)
    await turn(instance)

    check(llm.passesUsed() === 2, 'stops after one follow-up', `${llm.passesUsed()} passes`)
    check(spokenIn(sent) === '', 'nothing was said')
    // Nothing was spoken, so the TTS 'done' callback that normally settles the
    // state will never fire. Without this the mic indicator stays on "thinking"
    // and the idle nudge timer is never re-armed.
    const states = sent.filter((m): m is Extract<ServerMessage, { type: 'state' }> => m.type === 'state')
    check(
      states[states.length - 1]?.turn === 'idle',
      'settles back to idle anyway',
      `ended on "${states[states.length - 1]?.turn}"`,
    )
  }

  console.log(
    failures === 0
      ? `\n${GREEN}All tool-dispatch checks passed.${RESET}\n`
      : `\n${RED}${failures} check(s) failed.${RESET}\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

void main()
