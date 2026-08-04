import type { WorkspaceProblem } from '@/lib/problems/types'
import { WORKSPACE_RUBRIC } from '@/lib/problems/types'

/**
 * Frontend bug squash, running in the visible iframe.
 *
 * The stale closure is the single most common React bug that survives review:
 * the code reads correctly line by line, and the interval genuinely fires. It
 * just closes over the first render's `count` forever, so the display freezes at
 * 1 while the timer keeps running.
 *
 * TypeScript only — it's React.
 */
export const staleCounter: WorkspaceProblem = {
  kind: 'workspace',
  variant: 'frontend',
  slug: 'stale-counter',
  title: 'Auto-refreshing counter sticks at 1',
  difficulty: 'medium',
  languages: ['typescript'],
  topics: ['react', 'hooks', 'closures', 'debugging'],
  goal: 'The timer fires but the number stops. Watch it in the preview, then fix it.',
  statement: `The dashboard has a small "requests this minute" widget that ticks upward
on a timer. QA reports it "counts to 1 and stops", but the network tab shows the
underlying timer is still running.

There are **two** problems in \`Counter.tsx\`:

1. The displayed value stops advancing after the first tick.
2. The **Reset** button sets the count back to zero, but the display doesn't
   always follow — and rapid clicking makes it worse.

The preview on the right is live: it renders the real component, so you can watch
the behaviour while you change the code.

**Ground rules**

- \`Counter.tsx\` is the only file to change; the test file is read-only.
- \`start\` and \`stop\` from \`ticker.ts\` are a fine API — don't rewrite them.
- Keep using an interval. "Just render a static number" isn't a fix.`,
  testPath: { typescript: 'Counter.test.tsx' },
  startingState: 'failing',
  files: {
    typescript: [
      {
        path: 'Counter.tsx',
        content: `import { useEffect, useState } from 'react'
import { start, stop } from './ticker'

export function Counter() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const handle = start(() => {
      setCount(count + 1)
    })
    return () => stop(handle)
  }, [])

  return (
    <div>
      <p data-testid="count">Requests: {count}</p>
      <button data-testid="reset" onClick={() => setCount(0)}>
        Reset
      </button>
    </div>
  )
}
`,
      },
      {
        path: 'ticker.ts',
        readOnly: true,
        content: `export type TickHandle = ReturnType<typeof setInterval>

/** Calls \`onTick\` every 20ms. Fast on purpose so the tests stay quick. */
export function start(onTick: () => void): TickHandle {
  return setInterval(onTick, 20)
}

export function stop(handle: TickHandle): void {
  clearInterval(handle)
}
`,
      },
      {
        path: 'Counter.test.tsx',
        readOnly: true,
        content: `import { click, equal, ok, render, settle } from 'harness'
import { Counter } from './Counter'

function countText(view: { find: (s: string) => Element | null }) {
  return view.find('[data-testid="count"]')?.textContent ?? ''
}

export function testRendersTheInitialCount() {
  const view = render(<Counter />)
  equal(countText(view), 'Requests: 0')
  view.unmount()
}

export async function testTheCountKeepsAdvancingOnEveryTick() {
  const view = render(<Counter />)
  await settle(90) // roughly four ticks at 20ms

  const shown = countText(view)
  const value = Number(shown.replace('Requests: ', ''))

  ok(
    value >= 3,
    \`the timer fired several times but the display shows "\${shown}" - it should keep climbing\`,
  )
  view.unmount()
}

export async function testResetReturnsToZero() {
  const view = render(<Counter />)
  await settle(60)

  click(view.find('[data-testid="reset"]'))

  equal(countText(view), 'Requests: 0', 'clicking Reset should show zero immediately')
  view.unmount()
}

export async function testCountResumesClimbingAfterAReset() {
  const view = render(<Counter />)
  await settle(60)
  click(view.find('[data-testid="reset"]'))
  await settle(90)

  const value = Number(countText(view).replace('Requests: ', ''))
  ok(value >= 3, \`after a reset the counter should climb again, but it reached \${value}\`)
  view.unmount()
}

export async function testTheIntervalIsClearedOnUnmount() {
  const view = render(<Counter />)
  await settle(40)
  view.unmount()

  // If the interval outlives the component, React logs an update-after-unmount
  // warning and the handle keeps firing. A clean unmount leaves nothing running.
  const before = document.body.textContent
  await settle(80)
  equal(document.body.textContent, before, 'something is still updating after unmount')
}
`,
      },
    ],
  },
  referencePatch: {
    typescript: {
      'Counter.tsx': `import { useEffect, useState } from 'react'
import { start, stop } from './ticker'

export function Counter() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    // The functional update reads the *current* count at tick time. The previous
    // version closed over \`count\` from the first render, so it computed 0 + 1
    // forever. Keeping the effect's dependency list empty is now correct rather
    // than a bug, because the callback no longer depends on the rendered value.
    const handle = start(() => {
      setCount((current) => current + 1)
    })
    return () => stop(handle)
  }, [])

  return (
    <div>
      <p data-testid="count">Requests: {count}</p>
      <button data-testid="reset" onClick={() => setCount(0)}>
        Reset
      </button>
    </div>
  )
}
`,
    },
  },
  hintLadder: [
    'Watch the preview. Does it stop at 1, or does it never start?',
    'The interval callback is created once. What value of `count` can it see?',
    'That callback closed over the first render — `count` is 0 in there forever.',
    "Use the functional form of the setter so the update reads the current value rather than a captured one.",
  ],
  followUps: [
    'Why does adding `count` to the dependency array also "work", and what does it cost?',
    'When is the functional updater the right tool versus a ref?',
    'How would you test this without waiting on real timers?',
    'What would go wrong if `start` were called during render instead of in an effect?',
  ],
  rubric: WORKSPACE_RUBRIC.frontend,
}
