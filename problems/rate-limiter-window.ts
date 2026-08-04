import type { WorkspaceProblem } from '@/lib/problems/types'
import { WORKSPACE_RUBRIC } from '@/lib/problems/types'

/**
 * Extend an existing codebase. The fixed-window limiter already works and its
 * tests must keep passing — the candidate is adding a sibling, not rewriting.
 *
 * The interesting test is the boundary burst: a fixed window lets 2×limit through
 * either side of a reset, and that's precisely the flaw a sliding window exists to
 * fix. A candidate who reimplements fixed-window logic under a new name will pass
 * three of the four new tests and fail that one.
 */
export const rateLimiterWindow: WorkspaceProblem = {
  kind: 'workspace',
  variant: 'extend',
  slug: 'rate-limiter-window',
  title: 'Add a sliding-window rate limiter',
  difficulty: 'medium',
  topics: ['rate limiting', 'extending existing code', 'time windows'],
  goal: 'Implement SlidingWindowLimiter without breaking the existing limiter.',
  statement: `We rate-limit API clients with a **fixed window**: requests are counted
per 60-second bucket, and the count resets when the bucket rolls over.

That has a known flaw. A client can send the full limit at the *end* of one bucket
and the full limit again at the *start* of the next — twice the intended rate, in
a couple of seconds.

Add a \`SlidingWindowLimiter\` with the **same interface**, where the window moves
continuously with the current time instead of snapping to fixed buckets.

**Interface**

\`\`\`
limiter = SlidingWindowLimiter(limit=3, window_seconds=60)
limiter.allow("user-42", now=1000)   # -> True or False
\`\`\`

\`now\` is passed in as seconds rather than read from the clock, so the behaviour
is testable. A request counts against the window if it happened **within the last
\`window_seconds\`** — strictly after \`now - window_seconds\`.

**Ground rules**

- Don't change \`FixedWindowLimiter\`; its tests must stay green.
- Keys are independent of each other.`,
  testPath: {
    python: 'rate_limiter_test.py',
    typescript: 'rateLimiter.test.ts',
  },
  startingState: 'failing',
  files: {
    python: [
      {
        path: 'rate_limiter.py',
        content: `class FixedWindowLimiter:
    """Counts requests per fixed bucket of \`window_seconds\`.

    Simple and cheap, but allows a burst of up to 2x the limit across a
    bucket boundary.
    """

    def __init__(self, limit, window_seconds):
        self.limit = limit
        self.window_seconds = window_seconds
        self._counts = {}

    def allow(self, key, now):
        bucket = int(now // self.window_seconds)
        current = self._counts.get(key)

        if current is None or current[0] != bucket:
            current = [bucket, 0]
            self._counts[key] = current

        if current[1] >= self.limit:
            return False

        current[1] += 1
        return True


class SlidingWindowLimiter:
    """Same interface as FixedWindowLimiter, but the window moves with \`now\`."""

    def __init__(self, limit, window_seconds):
        self.limit = limit
        self.window_seconds = window_seconds

    def allow(self, key, now):
        raise NotImplementedError("implement the sliding window")
`,
      },
      {
        path: 'rate_limiter_test.py',
        readOnly: true,
        content: `from rate_limiter import FixedWindowLimiter, SlidingWindowLimiter


# --- existing behaviour: these already pass and must keep passing --------------


def test_fixed_window_allows_up_to_the_limit():
    limiter = FixedWindowLimiter(limit=3, window_seconds=60)
    assert limiter.allow("user", now=0) is True
    assert limiter.allow("user", now=1) is True
    assert limiter.allow("user", now=2) is True


def test_fixed_window_blocks_past_the_limit():
    limiter = FixedWindowLimiter(limit=2, window_seconds=60)
    limiter.allow("user", now=0)
    limiter.allow("user", now=1)
    assert limiter.allow("user", now=2) is False


def test_fixed_window_resets_at_the_bucket_boundary():
    limiter = FixedWindowLimiter(limit=1, window_seconds=60)
    assert limiter.allow("user", now=10) is True
    assert limiter.allow("user", now=50) is False
    assert limiter.allow("user", now=60) is True


def test_fixed_window_tracks_keys_independently():
    limiter = FixedWindowLimiter(limit=1, window_seconds=60)
    assert limiter.allow("alice", now=0) is True
    assert limiter.allow("bob", now=0) is True
    assert limiter.allow("alice", now=1) is False


# --- new behaviour ------------------------------------------------------------


def test_sliding_window_allows_up_to_the_limit():
    limiter = SlidingWindowLimiter(limit=3, window_seconds=60)
    assert limiter.allow("user", now=0) is True
    assert limiter.allow("user", now=1) is True
    assert limiter.allow("user", now=2) is True


def test_sliding_window_blocks_past_the_limit():
    limiter = SlidingWindowLimiter(limit=2, window_seconds=60)
    limiter.allow("user", now=0)
    limiter.allow("user", now=1)
    assert limiter.allow("user", now=2) is False


def test_sliding_window_allows_again_once_the_oldest_request_expires():
    limiter = SlidingWindowLimiter(limit=2, window_seconds=10)
    assert limiter.allow("user", now=0) is True
    assert limiter.allow("user", now=5) is True
    assert limiter.allow("user", now=9) is False
    # now=11 puts the request at t=0 outside the 10-second window.
    assert limiter.allow("user", now=11) is True


def test_sliding_window_prevents_a_burst_across_the_boundary():
    limiter = SlidingWindowLimiter(limit=3, window_seconds=60)
    for _ in range(3):
        assert limiter.allow("user", now=59) is True

    # A fixed window would roll over here and allow three more straight away.
    assert limiter.allow("user", now=61) is False, (
        "the three requests at t=59 are still inside a 60-second window at t=61"
    )


def test_sliding_window_tracks_keys_independently():
    limiter = SlidingWindowLimiter(limit=1, window_seconds=60)
    assert limiter.allow("alice", now=0) is True
    assert limiter.allow("bob", now=0) is True
    assert limiter.allow("alice", now=1) is False
`,
      },
    ],
    typescript: [
      {
        path: 'rateLimiter.ts',
        content: `/**
 * Counts requests per fixed bucket of \`windowSeconds\`.
 *
 * Simple and cheap, but allows a burst of up to 2x the limit across a
 * bucket boundary.
 */
export class FixedWindowLimiter {
  private counts = new Map<string, { bucket: number; count: number }>()

  constructor(
    readonly limit: number,
    readonly windowSeconds: number,
  ) {}

  allow(key: string, now: number): boolean {
    const bucket = Math.floor(now / this.windowSeconds)
    let current = this.counts.get(key)

    if (!current || current.bucket !== bucket) {
      current = { bucket, count: 0 }
      this.counts.set(key, current)
    }

    if (current.count >= this.limit) return false

    current.count += 1
    return true
  }
}

/** Same interface as FixedWindowLimiter, but the window moves with \`now\`. */
export class SlidingWindowLimiter {
  constructor(
    readonly limit: number,
    readonly windowSeconds: number,
  ) {}

  allow(key: string, now: number): boolean {
    throw new Error('implement the sliding window')
  }
}
`,
      },
      {
        path: 'rateLimiter.test.ts',
        readOnly: true,
        content: `import { equal, ok } from 'harness'
import { FixedWindowLimiter, SlidingWindowLimiter } from './rateLimiter'

// --- existing behaviour: these already pass and must keep passing -------------

export function testFixedWindowAllowsUpToTheLimit() {
  const limiter = new FixedWindowLimiter(3, 60)
  equal(limiter.allow('user', 0), true)
  equal(limiter.allow('user', 1), true)
  equal(limiter.allow('user', 2), true)
}

export function testFixedWindowBlocksPastTheLimit() {
  const limiter = new FixedWindowLimiter(2, 60)
  limiter.allow('user', 0)
  limiter.allow('user', 1)
  equal(limiter.allow('user', 2), false)
}

export function testFixedWindowResetsAtTheBucketBoundary() {
  const limiter = new FixedWindowLimiter(1, 60)
  equal(limiter.allow('user', 10), true)
  equal(limiter.allow('user', 50), false)
  equal(limiter.allow('user', 60), true)
}

export function testFixedWindowTracksKeysIndependently() {
  const limiter = new FixedWindowLimiter(1, 60)
  equal(limiter.allow('alice', 0), true)
  equal(limiter.allow('bob', 0), true)
  equal(limiter.allow('alice', 1), false)
}

// --- new behaviour -----------------------------------------------------------

export function testSlidingWindowAllowsUpToTheLimit() {
  const limiter = new SlidingWindowLimiter(3, 60)
  equal(limiter.allow('user', 0), true)
  equal(limiter.allow('user', 1), true)
  equal(limiter.allow('user', 2), true)
}

export function testSlidingWindowBlocksPastTheLimit() {
  const limiter = new SlidingWindowLimiter(2, 60)
  limiter.allow('user', 0)
  limiter.allow('user', 1)
  equal(limiter.allow('user', 2), false)
}

export function testSlidingWindowAllowsAgainOnceTheOldestRequestExpires() {
  const limiter = new SlidingWindowLimiter(2, 10)
  equal(limiter.allow('user', 0), true)
  equal(limiter.allow('user', 5), true)
  equal(limiter.allow('user', 9), false)
  // now=11 puts the request at t=0 outside the 10-second window.
  equal(limiter.allow('user', 11), true)
}

export function testSlidingWindowPreventsABurstAcrossTheBoundary() {
  const limiter = new SlidingWindowLimiter(3, 60)
  for (let i = 0; i < 3; i++) equal(limiter.allow('user', 59), true)

  // A fixed window would roll over here and allow three more straight away.
  ok(
    limiter.allow('user', 61) === false,
    'the three requests at t=59 are still inside a 60-second window at t=61',
  )
}

export function testSlidingWindowTracksKeysIndependently() {
  const limiter = new SlidingWindowLimiter(1, 60)
  equal(limiter.allow('alice', 0), true)
  equal(limiter.allow('bob', 0), true)
  equal(limiter.allow('alice', 1), false)
}
`,
      },
    ],
  },
  referencePatch: {
    python: {
      'rate_limiter.py': `class FixedWindowLimiter:
    def __init__(self, limit, window_seconds):
        self.limit = limit
        self.window_seconds = window_seconds
        self._counts = {}

    def allow(self, key, now):
        bucket = int(now // self.window_seconds)
        current = self._counts.get(key)

        if current is None or current[0] != bucket:
            current = [bucket, 0]
            self._counts[key] = current

        if current[1] >= self.limit:
            return False

        current[1] += 1
        return True


class SlidingWindowLimiter:
    def __init__(self, limit, window_seconds):
        self.limit = limit
        self.window_seconds = window_seconds
        self._hits = {}

    def allow(self, key, now):
        cutoff = now - self.window_seconds
        hits = [t for t in self._hits.get(key, []) if t > cutoff]
        self._hits[key] = hits

        if len(hits) >= self.limit:
            return False

        hits.append(now)
        return True
`,
    },
    typescript: {
      'rateLimiter.ts': `export class FixedWindowLimiter {
  private counts = new Map<string, { bucket: number; count: number }>()

  constructor(
    readonly limit: number,
    readonly windowSeconds: number,
  ) {}

  allow(key: string, now: number): boolean {
    const bucket = Math.floor(now / this.windowSeconds)
    let current = this.counts.get(key)

    if (!current || current.bucket !== bucket) {
      current = { bucket, count: 0 }
      this.counts.set(key, current)
    }

    if (current.count >= this.limit) return false

    current.count += 1
    return true
  }
}

export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>()

  constructor(
    readonly limit: number,
    readonly windowSeconds: number,
  ) {}

  allow(key: string, now: number): boolean {
    const cutoff = now - this.windowSeconds
    const kept = (this.hits.get(key) ?? []).filter((t) => t > cutoff)
    this.hits.set(key, kept)

    if (kept.length >= this.limit) return false

    kept.push(now)
    return true
  }
}
`,
    },
  },
  hintLadder: [
    'What does the fixed-window version store per key, and why is that not enough here?',
    'To know whether a request is still inside the window, what would you need to have kept?',
    'Store the timestamps themselves, then drop the ones older than `now - window_seconds`.',
    'Careful with the boundary: a request counts if it is strictly after the cutoff, not on it.',
  ],
  followUps: [
    'What is the memory cost per key here, and how does it scale with the limit?',
    'A sliding-window *counter* approximates this with two buckets. What does it trade away?',
    'These limiters are per-process. What breaks when you run ten API servers?',
    'Should a blocked request still count against the window? What would each choice encourage?',
  ],
  rubric: WORKSPACE_RUBRIC.extend,
}
