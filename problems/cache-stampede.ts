import type { WorkspaceProblem } from '@/lib/problems/types'
import { WORKSPACE_RUBRIC } from '@/lib/problems/types'

/**
 * A concurrency bug squash, and the best trap in the bank.
 *
 * The obvious fix for the stampede — keep a map of in-flight promises — breaks a
 * test that was passing before, because a rejected promise left in that map
 * poisons the key forever. So the round has a middle where the suite gets
 * *worse*, and what the interviewer learns is what the candidate does at that
 * moment: read the new failure, or undo the change.
 *
 * TypeScript only, and not for the usual reason. The Python harness calls each
 * test function synchronously, so an `async def` test would return a coroutine
 * nobody awaits and pass without running a single assertion — a silently green
 * suite is worse than no exercise at all.
 *
 * Time and loading are both injected, so nothing here sleeps and nothing is
 * timing-dependent. A flaky problem teaches the wrong lesson.
 */
export const cacheStampede: WorkspaceProblem = {
  kind: 'workspace',
  variant: 'bug-squash',
  slug: 'cache-stampede',
  title: 'One cache miss, fifty database queries',
  difficulty: 'hard',
  languages: ['typescript'],
  topics: ['concurrency', 'caching', 'async', 'debugging'],
  goal: 'Two tests are failing. Make a cold key cost exactly one load.',
  statement: `Our read-through cache works fine under light traffic. Under load, a
single expired key takes the database down.

The cause is a **cache stampede**: when a popular key expires, every request that
arrives before the first load finishes sees a miss, and every one of them starts
its own load. Fifty concurrent requests become fifty identical queries.

The fix is to remember that a load is already **in flight** and let everyone else
wait on it. Getting there is the exercise.

**What must hold**

- Concurrent \`get\` calls for the same cold key cause exactly **one** call to the
  loader. All of them receive the value.
- Concurrent calls for *different* keys still load independently.
- After the TTL passes, the next \`get\` loads again — once.
- **If a load fails, the failure must not be remembered.** Every waiter sees the
  rejection, and the next \`get\` after that tries again.

That last rule is the one to keep in mind while you fix the first: it is
currently passing, and the obvious change breaks it.

Time is injected as \`now()\` and the loader is injected too, so the tests are
deterministic — nothing here actually sleeps.`,
  testPath: { typescript: 'cache.test.ts' },
  startingState: 'failing',
  files: {
    typescript: [
      {
        path: 'cache.ts',
        content: `export interface CacheOptions {
  ttlMs: number
  /** Fetches the value for a key. Expensive; that is the whole point. */
  loader: (key: string) => Promise<string>
  /** Injected so tests can move time without waiting. */
  now: () => number
}

interface Entry {
  value: string
  expiresAt: number
}

/**
 * A read-through cache with a time-to-live.
 *
 * Works. Falls over under concurrency.
 */
export class ReadThroughCache {
  private entries = new Map<string, Entry>()

  constructor(private options: CacheOptions) {}

  async get(key: string): Promise<string> {
    const hit = this.entries.get(key)
    if (hit && hit.expiresAt > this.options.now()) {
      return hit.value
    }

    const value = await this.options.loader(key)
    this.entries.set(key, { value, expiresAt: this.options.now() + this.options.ttlMs })
    return value
  }
}
`,
      },
      {
        path: 'cache.test.ts',
        readOnly: true,
        content: `import { deepEqual, equal, ok } from 'harness'
import { ReadThroughCache } from './cache'

/**
 * A loader you resolve by hand, so a load can be held open mid-test.
 *
 * Settles *every* outstanding call, not just the most recent one. Holding only
 * the latest looks equivalent and is not: the broken cache starts four loads, so
 * three promises would never settle and the test would hang instead of failing.
 */
function controllableLoader() {
  const calls: string[] = []
  const pending: { resolve: (value: string) => void; reject: (error: Error) => void }[] = []

  const loader = (key: string) =>
    new Promise<string>((resolve, reject) => {
      calls.push(key)
      pending.push({ resolve, reject })
    })

  return {
    loader,
    calls,
    resolve: (value: string) => pending.splice(0).forEach((call) => call.resolve(value)),
    reject: (message: string) =>
      pending.splice(0).forEach((call) => call.reject(new Error(message))),
  }
}

function clock(start = 1000) {
  let current = start
  return { now: () => current, advance: (ms: number) => (current += ms) }
}

export async function testServesFromCacheWithinTheTtl() {
  const { loader, calls, resolve } = controllableLoader()
  const time = clock()
  const cache = new ReadThroughCache({ ttlMs: 100, loader, now: time.now })

  const first = cache.get('a')
  resolve('value')
  equal(await first, 'value')
  equal(await cache.get('a'), 'value')
  equal(calls.length, 1, 'a warm key should not reach the loader')
}

export async function testLoadsAgainAfterTheTtlExpires() {
  const { loader, calls, resolve } = controllableLoader()
  const time = clock()
  const cache = new ReadThroughCache({ ttlMs: 100, loader, now: time.now })

  const first = cache.get('a')
  resolve('one')
  await first

  time.advance(101)
  const second = cache.get('a')
  resolve('two')
  equal(await second, 'two')
  equal(calls.length, 2, 'an expired key should load again')
}

export async function testAFailedLoadIsNotRemembered() {
  const { loader, calls, resolve, reject } = controllableLoader()
  const time = clock()
  const cache = new ReadThroughCache({ ttlMs: 100, loader, now: time.now })

  const failing = cache.get('a')
  reject('upstream is down')
  let raised = false
  try {
    await failing
  } catch {
    raised = true
  }
  ok(raised, 'the caller should see the failure')

  const retried = cache.get('a')
  resolve('recovered')
  equal(await retried, 'recovered', 'the next get should try again')
  equal(calls.length, 2, 'a failed load must not be cached')
}

export async function testConcurrentMissesLoadOnce() {
  const { loader, calls, resolve } = controllableLoader()
  const time = clock()
  const cache = new ReadThroughCache({ ttlMs: 100, loader, now: time.now })

  const waiting = [cache.get('a'), cache.get('a'), cache.get('a'), cache.get('a')]
  resolve('value')

  deepEqual(await Promise.all(waiting), ['value', 'value', 'value', 'value'])
  equal(calls.length, 1, 'four concurrent misses on one key should load once')
}

export async function testAStampedeAfterExpiryStillLoadsOnce() {
  const { loader, calls, resolve } = controllableLoader()
  const time = clock()
  const cache = new ReadThroughCache({ ttlMs: 100, loader, now: time.now })

  const warm = cache.get('a')
  resolve('one')
  await warm

  // The dangerous moment in production: a popular key expires and every request
  // in flight at that instant misses together.
  time.advance(101)
  const waiting = [cache.get('a'), cache.get('a'), cache.get('a')]
  resolve('two')

  deepEqual(await Promise.all(waiting), ['two', 'two', 'two'])
  equal(calls.length, 2, 'expiry should cost one load, not one per waiter')
}

export async function testConcurrentMissesOnDifferentKeysLoadSeparately() {
  const calls: string[] = []
  const loader = async (key: string) => {
    calls.push(key)
    return key.toUpperCase()
  }
  const time = clock()
  const cache = new ReadThroughCache({ ttlMs: 100, loader, now: time.now })

  deepEqual(await Promise.all([cache.get('a'), cache.get('b')]), ['A', 'B'])
  equal(calls.length, 2, 'different keys are different loads')
}

export async function testEveryWaiterSeesAFailure() {
  const { loader, reject } = controllableLoader()
  const time = clock()
  const cache = new ReadThroughCache({ ttlMs: 100, loader, now: time.now })

  const waiting = [cache.get('a'), cache.get('a')]
  reject('upstream is down')

  const outcomes = await Promise.all(
    waiting.map((promise) => promise.then(() => 'resolved').catch(() => 'rejected')),
  )
  deepEqual(outcomes, ['rejected', 'rejected'])
}
`,
      },
    ],
  },
  referencePatch: {
    typescript: {
      'cache.ts': `export interface CacheOptions {
  ttlMs: number
  /** Fetches the value for a key. Expensive; that is the whole point. */
  loader: (key: string) => Promise<string>
  /** Injected so tests can move time without waiting. */
  now: () => number
}

interface Entry {
  value: string
  expiresAt: number
}

/**
 * A read-through cache with a time-to-live, safe under concurrency.
 */
export class ReadThroughCache {
  private entries = new Map<string, Entry>()
  /** Loads that have started and not yet settled, so a cold key loads once. */
  private inFlight = new Map<string, Promise<string>>()

  constructor(private options: CacheOptions) {}

  async get(key: string): Promise<string> {
    const hit = this.entries.get(key)
    if (hit && hit.expiresAt > this.options.now()) {
      return hit.value
    }

    const existing = this.inFlight.get(key)
    if (existing) return existing

    const load = this.options.loader(key)
      .then((value) => {
        this.entries.set(key, { value, expiresAt: this.options.now() + this.options.ttlMs })
        return value
      })
      .finally(() => {
        // Cleared on failure as well as success. A rejected promise left here
        // would be handed to every future caller, so one bad minute upstream
        // would poison the key until the process restarted.
        this.inFlight.delete(key)
      })

    this.inFlight.set(key, load)
    return load
  }
}
`,
    },
  },
  hintLadder: [
    'Two of the tests are about what happens when calls overlap. What does the current code do between the miss and the value arriving?',
    'Walk through four calls arriving before the first load finishes. How far does each one get before any of them has a value?',
    'The cache remembers values. What would it have to remember to know that a load has already started?',
    'If you store the in-flight promise and hand it to later callers, what happens to that stored promise when the load fails?',
    'Store the promise while it runs, and delete it when it settles — on rejection as well as on success.',
  ],
  followUps: [
    'What happens now if the loader never settles at all?',
    'This cache grows forever. What would you add, and what would you have to measure first?',
    'Would you serve a stale value while a refresh is in flight? What does that trade away?',
    'How would this change if the cache were shared across several processes rather than one?',
  ],
  rubric: WORKSPACE_RUBRIC['bug-squash'],
}
