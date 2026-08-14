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

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getProblem } from '../problems'
import { getQuestion } from '../questions'
import { loadBackchannels } from '../server/interview/backchannel'
import { InterviewSession } from '../server/interview/orchestrator'
import { toolsFor } from '../server/interview/tools'
import type { LLMProvider, Message, StreamResult, ToolCall } from '../server/pipeline/llm'
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
function stubLLM(
  passes: Pass[],
  graded = '{"covered":[]}',
): LLMProvider & { passesUsed: () => number; lastPrompt: () => Message[] } {
  let index = 0
  let prompt: Message[] = []
  return {
    name: 'stub',
    passesUsed: () => index,
    /** What the interviewer was actually shown on the most recent turn. */
    lastPrompt: () => prompt,
    async stream(options): Promise<StreamResult> {
      prompt = options.history
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
    // The grader's path. Never the streaming one.
    async complete() {
      return graded
    },
  }
}

function session(llm: LLMProvider, slug = 'flaky-retry') {
  const sent: ServerMessage[] = []
  const problem = getProblem(slug) ?? getQuestion(slug)
  if (!problem) throw new Error(`${slug} is missing`)

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

  console.log('\nA spoken round')
  {
    const names = toolsFor('discussion').map((tool) => tool.name)
    // It was a tool and is now a separate model call — see grader.ts. Offering
    // both would let the two disagree about the same tally.
    check(!names.includes('mark_covered'), 'the interviewer cannot tick points itself', names.join(', '))
    check(names.includes('conclude_round'), 'but it can still end the round')
    check(!toolsFor('workspace').some((t) => t.name === 'conclude_round'), 'a coding round cannot')

    const llm = stubLLM(
      [{ text: 'And what does that cost you on the write side?' }],
      '{"covered":[{"index":2,"quote":"go down in the tree"}]}',
    )
    const { instance, sent } = session(llm, 'concept-database-index')
    instance.rehydrate([
      { role: 'interviewer', text: 'What actually changes when you add an index?', at: 1 },
      { role: 'candidate', text: 'You search by going down in the tree, not reading every row.', at: 2 },
    ])
    await sleep(60)

    check(instance.transcript.length === 2, 'reopens with what was already said')
    check(instance.covered.join(',') === '2', 'recomputes the tally from the transcript', `[${instance.covered}]`)
    check(
      sent.some((m) => m.type === 'objective' && m.covered.join(',') === '2'),
      'and tells the browser, so the pips come back',
    )

    await turn(instance)
    const prompt = llm.lastPrompt()
    const asText = prompt.map((m) => m.content).join('\n')
    check(asText.includes('resuming after a break'), 'tells the interviewer it is resuming')
    check(asText.includes('going down in the tree'), 'and hands it what was said before')
    // The interviewer no longer keeps its own tally, so this note is the only
    // thing that stops it re-probing ground already covered.
    const volatile = prompt[prompt.length - 1]?.content ?? ''
    check(volatile.includes('Points reached so far: 2'), 'the volatile note carries the tally')
    check(volatile.includes('Still open'), 'and says what is left to probe')
    // Constraint 3: anything that changes per turn must stay out of the prefix.
    check(!asText.startsWith('[Points'), 'and it goes after the history, not into the cached prefix')
    await instance.end()
  }

  console.log('\nBackchannel clips')
  {
    // Real committed clips, read off disk.
    const live = loadBackchannels(undefined, () => 0)
    check(live.size >= 4, 'loads the committed clips', `${live.size} clips`)
    const clip = live.next()
    check(clip !== null && clip.length > 0, 'returns playable PCM', `${clip?.length ?? 0} bytes`)
    // 16kHz mono PCM16 — two bytes per sample, and an odd length would mean the
    // WAV header was sliced at the wrong offset.
    check((clip?.length ?? 1) % 2 === 0, 'sample-aligned, so the header was parsed')

    // A `LIST` chunk before `data` is legal, and slicing at a fixed 44 bytes
    // would feed those bytes to the speaker as noise.
    const dir = mkdtempSync(join(tmpdir(), 'backchannel-'))
    const pcm = Buffer.alloc(320, 7)
    const list = Buffer.from('LIST   INFO', 'binary')
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(36 + list.length + pcm.length, 4)
    header.write('WAVE', 8)
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(1, 22)
    header.writeUInt32LE(16_000, 24)
    header.writeUInt32LE(32_000, 28)
    header.writeUInt16LE(2, 32)
    header.writeUInt16LE(16, 34)
    header.write('data', 36)
    header.writeUInt32LE(pcm.length, 40)
    writeFileSync(
      join(dir, 'padded.wav'),
      Buffer.concat([header.subarray(0, 36), list, header.subarray(36), pcm]),
    )
    const padded = loadBackchannels(dir, () => 0).next()
    check(padded?.length === pcm.length, 'skips non-audio chunks', `${padded?.length} of ${pcm.length} bytes`)
    check(padded?.[0] === 7, 'and starts at the real audio')

    // Hearing the same token twice running is more obviously synthetic than
    // saying nothing would have been.
    const sequence = loadBackchannels(undefined, () => 0.5)
    const first = sequence.next()
    const second = sequence.next()
    check(first !== null && second !== null && !first.equals(second), 'never repeats back to back')

    // A pause before a hard follow-up is in character, not a defect.
    check(loadBackchannels(undefined, () => 0.99).next() === null, 'stays silent on some turns')

    check(loadBackchannels(join(dir, 'nope')).next() === null, 'degrades quietly with no clips')
  }

  console.log(
    failures === 0
      ? `\n${GREEN}All tool-dispatch checks passed.${RESET}\n`
      : `\n${RED}${failures} check(s) failed.${RESET}\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

void main()
