import type { RapidFireSet } from '@/lib/problems/types'

/**
 * The set that cost the NextDay AI screen.
 *
 * The written feedback named two things: the event loop was "not fully formed",
 * and functional programming and immutability were "surface-level". Both are
 * first here on purpose — a drill that saves the known weakness for question
 * eight is a drill you stop before reaching it.
 */
export const javascriptFundamentals: RapidFireSet = {
  slug: 'drill-javascript',
  title: 'JavaScript fundamentals',
  difficulty: 'medium',
  topics: ['javascript', 'async', 'functional programming'],
  blurb: 'The canon a JS screen draws from. Event loop and immutability first.',
  seconds: 60,
  questions: [
    {
      id: 'event-loop',
      prompt: 'Explain the JavaScript event loop.',
      topic: 'event loop',
      expectedPoints: [
        'JavaScript runs on a single thread with one call stack',
        'the runtime does the waiting outside that thread and queues the callback when it is done; the loop moves a callback onto the stack only when the stack is empty',
        'microtasks (promise continuations) drain completely before the next macrotask (setTimeout, I/O)',
      ],
    },
    {
      id: 'microtask-order',
      prompt:
        'A script logs 1, then schedules setTimeout logging 2 with zero delay, then a resolved promise logging 3, then logs 4. What order do they print, and why?',
      topic: 'event loop',
      expectedPoints: [
        'the order is 1, 3, 4, 2',
        '1 and 4 are synchronous so they run first, in source order',
        'the promise callback is a microtask and the whole microtask queue drains before setTimeout, which is a macrotask — a zero delay does not make it immediate',
      ],
    },
    {
      id: 'closures',
      prompt: 'What is a closure?',
      topic: 'closures',
      expectedPoints: [
        'a function keeps access to the variables of the scope it was created in, even after that scope has finished',
        'a concrete use: hooks, debounce, event handlers reading outer variables, or a private counter',
      ],
    },
    {
      id: 'functional-programming',
      prompt: 'What is functional programming, and what does immutability buy you?',
      topic: 'functional programming',
      expectedPoints: [
        'building behaviour by composing pure functions — same input, same output, no side effects — instead of mutating shared state',
        'immutability means producing a new value rather than changing the old one, with spread or similar, so nothing else holding the old reference is surprised',
        'higher-order functions are the everyday form of it: map, filter and reduce, or a function that returns a function',
      ],
    },
    {
      id: 'immutability-react',
      prompt:
        'Why does React insist you replace state rather than mutate it? What breaks if you push onto an array in state?',
      topic: 'functional programming',
      expectedPoints: [
        'React compares by reference to decide whether anything changed, so a mutated array is the same reference and the change is invisible',
        'the component does not re-render, or re-renders inconsistently — the UI and the data disagree',
        'the fix is to build a new array or object: spread it, or map to a new one',
      ],
    },
    {
      id: 'var-let-const',
      prompt: 'Difference between var, let and const, and what does hoisting mean?',
      topic: 'scoping',
      expectedPoints: [
        'var is function-scoped, let and const are block-scoped',
        'var declarations are hoisted and readable as undefined before their line; let and const are hoisted too but unreachable until declared — the temporal dead zone',
        'const prevents reassigning the binding, not mutating the object it points at',
      ],
    },
    {
      id: 'this',
      prompt: 'How is the value of `this` decided?',
      topic: 'this',
      expectedPoints: [
        'by how the function is called, not where it is defined',
        'called as a method it is the object; called plainly it is undefined in strict mode',
        'arrow functions have no `this` of their own and inherit it lexically, which is why they are used for callbacks',
      ],
    },
    {
      id: 'promise-all',
      prompt:
        'You need to fetch three independent things. What do you write, and what happens if one of them rejects?',
      topic: 'async',
      expectedPoints: [
        'start all three and await Promise.all, rather than awaiting each in turn — sequential awaits make it three round trips instead of one',
        'Promise.all rejects as soon as any one rejects, and you lose the results of the others',
        'Promise.allSettled when you want every outcome regardless',
      ],
    },
    {
      id: 'debounce-throttle',
      prompt: 'Debounce versus throttle.',
      topic: 'async',
      expectedPoints: [
        'debounce runs once after the calls stop, so a search box fires one request when typing pauses',
        'throttle runs at most once every N milliseconds while calls keep coming, which is what a scroll or resize handler wants',
      ],
    },
    {
      id: 'shallow-deep-copy',
      prompt: 'Shallow versus deep copy in JavaScript.',
      topic: 'objects',
      expectedPoints: [
        'spread and Object.assign copy one level, so nested objects are still shared references',
        'mutating a nested object through the copy changes the original',
        'structuredClone for a real deep copy, or a manual recursive copy',
      ],
    },
    {
      id: 'equality',
      prompt: 'Double equals versus triple equals.',
      topic: 'operators',
      expectedPoints: [
        'double equals coerces types before comparing, triple equals does not',
        'use triple equals; the coercion rules produce surprises like a string equalling a number',
      ],
    },
    {
      id: 'prototypes',
      prompt: 'What is prototypal inheritance?',
      topic: 'objects',
      expectedPoints: [
        'objects delegate to another object — their prototype — and a missing property is looked up along that chain',
        'the class keyword is syntax over the same mechanism, not a separate system',
      ],
    },
  ],
}
