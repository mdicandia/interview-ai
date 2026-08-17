import type { RapidFireSet } from '@/lib/problems/types'

/**
 * Transcribed from React-QA-Bank.md, which holds the spoken 30–60 second version
 * of each of these rather than a definition.
 *
 * Written as they are asked out loud, so several are a scenario rather than a
 * term — "a component re-renders too much, how do you find it" is what a screen
 * actually says, and answering it needs a method rather than a name.
 */
export const reactFundamentals: RapidFireSet = {
  slug: 'drill-react',
  title: 'React fundamentals',
  difficulty: 'medium',
  topics: ['react', 'hooks', 'frontend'],
  blurb: 'Rendering, hooks and the re-render questions every frontend screen asks.',
  seconds: 60,
  questions: [
    {
      id: 'virtual-dom',
      prompt: 'What is the virtual DOM, and what is reconciliation?',
      topic: 'rendering',
      expectedPoints: [
        'an in-memory representation of the UI that React builds on each render',
        'reconciliation is diffing the new tree against the previous one and applying only the minimal real DOM changes',
        'the reason it is worth it: real DOM operations are expensive, diffing in memory is cheap',
      ],
    },
    {
      id: 'keys',
      prompt: 'Why do list items need a key, and why not the array index?',
      topic: 'rendering',
      expectedPoints: [
        'keys let the reconciler match items across renders so it reuses DOM nodes instead of recreating them',
        'an index breaks on reorder, insert or delete: items get matched to the wrong previous item, and state inside a row — an input value, focus — jumps to the wrong row',
        'use a stable unique id from the data',
      ],
    },
    {
      id: 'usestate-batching',
      prompt:
        'You call setCount(count + 1) twice in one click handler. What happens, and how do you fix it?',
      topic: 'hooks',
      expectedPoints: [
        'it adds one, not two: both calls read the same stale count from that render',
        'the fix is the functional form, setCount(c => c + 1), which is given the latest value',
        'state updates are batched and applied before the next render, not immediately',
      ],
    },
    {
      id: 'useeffect',
      prompt: 'Explain useEffect — the dependency array and the cleanup function.',
      topic: 'hooks',
      expectedPoints: [
        'it runs a side effect after render; the deps array controls when — empty runs once on mount, a listed value runs when that value changes, no array runs every render',
        'the cleanup runs before the next execution and on unmount: cancel subscriptions, timers, in-flight requests',
        'the classic bugs are missing deps producing a stale closure, and fetching without cancellation producing a race',
      ],
    },
    {
      id: 'memo-trio',
      prompt: 'useMemo, useCallback and React.memo — what does each one do?',
      topic: 'performance',
      expectedPoints: [
        'useMemo caches a computed value; useCallback caches a function identity; React.memo skips re-rendering a component whose props are shallow-equal',
        'they work together: React.memo is useless if you pass a new inline function every render, which is when useCallback earns its place',
        'measure first — sprinkling them everywhere adds cost and hides nothing',
      ],
    },
    {
      id: 'excess-rerenders',
      prompt: 'A component re-renders too much. How do you find out why, and what do you do?',
      topic: 'performance',
      expectedPoints: [
        'measure first with the React DevTools Profiler, which shows what rendered and why',
        'common causes: new object, array or function literals passed as props each render; one fat context that everything subscribes to; state living higher than it needs to',
        'the fixes in kind: memoize or hoist the literal, split the context, push state down, and virtualize long lists',
      ],
    },
    {
      id: 'context-vs-store',
      prompt: 'When do you reach for Context, and when for a state manager?',
      topic: 'state',
      expectedPoints: [
        'Context solves prop drilling for low-frequency values — theme, auth, locale',
        'it is not a state manager: every consumer re-renders when the value changes, so high-frequency state in Context hurts',
        'a store gives granular subscriptions, devtools and middleware for genuinely shared client state',
      ],
    },
    {
      id: 'server-vs-client-state',
      prompt: 'What is the difference between server state and client state?',
      topic: 'state',
      expectedPoints: [
        'server state is fetched data with problems client state does not have: caching, staleness, refetching, deduplication, background updates',
        'a query library handles those declaratively instead of hand-rolling loading and error flags in a store',
        'the practical observation: most so-called global state turns out to be server state, and once it moves there very little genuine client state is left',
      ],
    },
    {
      id: 'controlled-uncontrolled',
      prompt: 'Controlled versus uncontrolled components.',
      topic: 'forms',
      expectedPoints: [
        'controlled means the value lives in React state and every keystroke goes through onChange — one source of truth, easy validation',
        'uncontrolled leaves the value in the DOM and you read it from a ref when you need it — less code and fewer re-renders',
      ],
    },
    {
      id: 'custom-hooks',
      prompt: 'What is a custom hook, and what are the rules of hooks?',
      topic: 'hooks',
      expectedPoints: [
        'a function starting with `use` that composes other hooks to package reusable stateful logic, not UI',
        'hooks must be called at the top level of a component or another hook — never in a condition, loop or nested function — because React tracks them by call order',
      ],
    },
    {
      id: 'error-boundaries',
      prompt: 'What is an error boundary, and what does it not catch?',
      topic: 'errors',
      expectedPoints: [
        'a component that catches render-time errors in its subtree and shows a fallback instead of blanking the whole app',
        'it does not catch errors in event handlers or async code — those you handle and report yourself',
      ],
    },
    {
      id: 'streaming-chat-ui',
      prompt: 'How would you build a streaming chat UI for an LLM response?',
      topic: 'architecture',
      expectedPoints: [
        'a token stream from the server over SSE or a WebSocket, appended into the current message as chunks arrive',
        'batch the updates so you are not re-rendering per token, and virtualize a long history',
        'scroll anchoring — stick to the bottom only if the user is already at the bottom — plus handling an interrupted stream and a retry',
      ],
    },
  ],
}
