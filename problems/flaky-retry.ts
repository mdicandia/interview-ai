import type { WorkspaceProblem } from '@/lib/problems/types'
import { WORKSPACE_RUBRIC } from '@/lib/problems/types'

/**
 * Bug squash. Three defects are planted, and they're deliberately of different
 * kinds so a candidate can't pattern-match one fix onto the rest:
 *
 *   1. the backoff never grows — `base_delay` is reused instead of doubled
 *   2. it sleeps after the *final* attempt, wasting a wait before giving up
 *   3. it swallows the failure and returns None instead of re-raising
 *
 * Two of the five tests pass from the start. That matters: a suite that's all red
 * tells you nothing about where to look, and a real bug report never arrives with
 * every test broken.
 */
export const flakyRetry: WorkspaceProblem = {
  kind: 'workspace',
  variant: 'bug-squash',
  slug: 'flaky-retry',
  title: 'Retry helper drops errors',
  difficulty: 'medium',
  topics: ['debugging', 'error handling', 'retries'],
  goal: 'Three tests are failing. Find and fix the bugs in the retry helper.',
  statement: `A teammate wrote a \`retry\` helper for calls to a flaky upstream service.
It shipped last week, and since then two things have gone wrong in production:

1. An on-call engineer reported that when the upstream is down, the caller gets
   \`None\` back instead of an error — so failures look like empty responses and
   nobody gets paged.
2. The retries are hammering the upstream instead of backing off.

There are **three separate bugs**. The test suite covers all of them.

**Ground rules**

- \`retry.py\` / \`retry.ts\` is the only file you should need to change.
- The test file is read-only — it describes the intended behaviour.
- \`sleep\` is injected so the tests can assert on backoff without actually waiting.`,
  testPath: { python: 'retry_test.py', typescript: 'retry.test.ts' },
  startingState: 'failing',
  files: {
    python: [
      {
        path: 'retry.py',
        content: `import time


def retry(operation, max_attempts=3, base_delay=1.0, sleep=time.sleep):
    """Call \`operation\`, retrying on failure with exponential backoff.

    Returns whatever the operation returns. If every attempt fails, the last
    error should reach the caller.
    """
    last_error = None

    for attempt in range(max_attempts):
        try:
            return operation()
        except Exception as exc:
            last_error = exc
            sleep(base_delay)

    return None
`,
      },
      {
        path: 'retry_test.py',
        readOnly: true,
        content: `from retry import retry


class SleepRecorder:
    """Stands in for time.sleep so tests can assert on backoff without waiting."""

    def __init__(self):
        self.delays = []

    def __call__(self, seconds):
        self.delays.append(seconds)


def flaky(failures, result="ok"):
    """An operation that raises ConnectionError \`failures\` times, then succeeds."""
    calls = []

    def operation():
        calls.append(1)
        if len(calls) <= failures:
            raise ConnectionError("attempt %d failed" % len(calls))
        return result

    return operation, calls


def test_returns_the_result_without_retrying_when_it_succeeds():
    operation, calls = flaky(failures=0)
    sleeper = SleepRecorder()

    assert retry(operation, sleep=sleeper) == "ok"
    assert len(calls) == 1
    assert sleeper.delays == []


def test_retries_until_the_operation_succeeds():
    operation, calls = flaky(failures=2)
    sleeper = SleepRecorder()

    assert retry(operation, max_attempts=3, base_delay=1.0, sleep=sleeper) == "ok"
    assert len(calls) == 3


def test_backoff_doubles_between_attempts():
    operation, _calls = flaky(failures=2)
    sleeper = SleepRecorder()

    retry(operation, max_attempts=3, base_delay=0.5, sleep=sleeper)

    assert sleeper.delays == [0.5, 1.0], (
        "expected the wait to double each time, got %r" % sleeper.delays
    )


def test_raises_the_last_error_when_every_attempt_fails():
    operation, calls = flaky(failures=99)
    sleeper = SleepRecorder()

    try:
        result = retry(operation, max_attempts=3, base_delay=1.0, sleep=sleeper)
    except ConnectionError as exc:
        assert "attempt 3" in str(exc), "expected the *last* error, got %r" % str(exc)
    else:
        raise AssertionError(
            "retry should re-raise the final error, but it returned %r" % (result,)
        )

    assert len(calls) == 3


def test_does_not_sleep_after_the_final_attempt():
    operation, _calls = flaky(failures=99)
    sleeper = SleepRecorder()

    try:
        retry(operation, max_attempts=3, base_delay=1.0, sleep=sleeper)
    except ConnectionError:
        pass

    assert len(sleeper.delays) == 2, (
        "3 attempts means 2 waits, not %d - the last failure should give up immediately"
        % len(sleeper.delays)
    )
`,
      },
    ],
    typescript: [
      {
        path: 'retry.ts',
        content: `export interface RetryOptions {
  maxAttempts?: number
  baseDelay?: number
  sleep?: (ms: number) => void
}

/**
 * Call \`operation\`, retrying on failure with exponential backoff.
 *
 * Returns whatever the operation returns. If every attempt fails, the last
 * error should reach the caller.
 */
export function retry<T>(operation: () => T, options: RetryOptions = {}): T {
  const { maxAttempts = 3, baseDelay = 1000, sleep = () => {} } = options
  let lastError: unknown = null

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return operation()
    } catch (error) {
      lastError = error
      sleep(baseDelay)
    }
  }

  return undefined as T
}
`,
      },
      {
        path: 'retry.test.ts',
        readOnly: true,
        content: `import { deepEqual, equal, ok } from 'harness'
import { retry } from './retry'

/** Stands in for a real sleep so tests can assert on backoff without waiting. */
function sleepRecorder() {
  const delays: number[] = []
  return { delays, sleep: (ms: number) => delays.push(ms) }
}

/** An operation that throws \`failures\` times, then succeeds. */
function flaky(failures: number, result = 'ok') {
  const calls = { count: 0 }
  const operation = () => {
    calls.count += 1
    if (calls.count <= failures) throw new Error(\`attempt \${calls.count} failed\`)
    return result
  }
  return { operation, calls }
}

export function testReturnsTheResultWithoutRetryingWhenItSucceeds() {
  const { operation, calls } = flaky(0)
  const { delays, sleep } = sleepRecorder()

  equal(retry(operation, { sleep }), 'ok')
  equal(calls.count, 1)
  deepEqual(delays, [])
}

export function testRetriesUntilTheOperationSucceeds() {
  const { operation, calls } = flaky(2)
  const { sleep } = sleepRecorder()

  equal(retry(operation, { maxAttempts: 3, baseDelay: 1000, sleep }), 'ok')
  equal(calls.count, 3)
}

export function testBackoffDoublesBetweenAttempts() {
  const { operation } = flaky(2)
  const { delays, sleep } = sleepRecorder()

  retry(operation, { maxAttempts: 3, baseDelay: 500, sleep })

  deepEqual(delays, [500, 1000], 'expected the wait to double each time')
}

export function testThrowsTheLastErrorWhenEveryAttemptFails() {
  const { operation, calls } = flaky(99)
  const { sleep } = sleepRecorder()

  let thrown: unknown
  let returned: unknown
  try {
    returned = retry(operation, { maxAttempts: 3, baseDelay: 1000, sleep })
  } catch (error) {
    thrown = error
  }

  ok(
    thrown !== undefined,
    \`retry should rethrow the final error, but it returned \${JSON.stringify(returned)}\`,
  )
  ok(
    String((thrown as Error).message).includes('attempt 3'),
    \`expected the *last* error, got "\${(thrown as Error).message}"\`,
  )
  equal(calls.count, 3)
}

export function testDoesNotSleepAfterTheFinalAttempt() {
  const { operation } = flaky(99)
  const { delays, sleep } = sleepRecorder()

  try {
    retry(operation, { maxAttempts: 3, baseDelay: 1000, sleep })
  } catch {
    // expected once the bug is fixed
  }

  equal(
    delays.length,
    2,
    '3 attempts means 2 waits - the last failure should give up immediately',
  )
}
`,
      },
    ],
  },
  referencePatch: {
    python: {
      'retry.py': `import time


def retry(operation, max_attempts=3, base_delay=1.0, sleep=time.sleep):
    """Call \`operation\`, retrying on failure with exponential backoff."""
    last_error = None

    for attempt in range(max_attempts):
        try:
            return operation()
        except Exception as exc:
            last_error = exc
            if attempt < max_attempts - 1:
                sleep(base_delay * (2 ** attempt))

    raise last_error
`,
    },
    typescript: {
      'retry.ts': `export interface RetryOptions {
  maxAttempts?: number
  baseDelay?: number
  sleep?: (ms: number) => void
}

export function retry<T>(operation: () => T, options: RetryOptions = {}): T {
  const { maxAttempts = 3, baseDelay = 1000, sleep = () => {} } = options
  let lastError: unknown = null

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return operation()
    } catch (error) {
      lastError = error
      if (attempt < maxAttempts - 1) sleep(baseDelay * 2 ** attempt)
    }
  }

  throw lastError
}
`,
    },
  },
  hintLadder: [
    'Which of the failing tests looks easiest to reproduce in your head? Start there.',
    'Read the assertion messages — each one names the behaviour it expected.',
    'Compare the number of sleeps against the number of attempts. Should those be equal?',
    'What happens to `last_error` after the loop finishes? Nothing reads it.',
  ],
  followUps: [
    'Which of these three bugs would you have caught in code review, and which needed the test?',
    'The retry catches every exception. Should it? What would you *not* want to retry?',
    'How would you add jitter, and why does it matter when many clients retry at once?',
    'This blocks the calling thread. What changes if the operation is async?',
  ],
  rubric: WORKSPACE_RUBRIC['bug-squash'],
}
