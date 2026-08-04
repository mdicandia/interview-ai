import type { DiscussionProblem } from '@/lib/problems/types'
import { DISCUSSION_RUBRIC } from '@/lib/problems/types'

/**
 * The frontend counterpart to the Python review. The planted issues are the ones
 * that survive review in real React codebases because each looks locally
 * reasonable: a race between responses, a missing cleanup, an unstable
 * dependency, and error handling that hides the failure.
 */
export const codeReviewTypescript: DiscussionProblem = {
  kind: 'discussion',
  format: 'code-review',
  slug: 'code-review-search-hook',
  title: 'Review: search-as-you-type hook',
  difficulty: 'medium',
  languages: ['typescript'],
  expectedMinutes: 12,
  topics: ['code review', 'react', 'async', 'race conditions'],
  statement: `A colleague has opened a pull request with a \`useSearch\` hook powering a
search-as-you-type box. It works on their machine and the demo looked fine.

Read \`useSearch.ts\` and review it as you would a real PR.`,
  prompt:
    'Walk me through this pull request. What would block the merge, and what is ' +
    'just preference?',
  context: [
    {
      path: 'useSearch.ts',
      readOnly: true,
      content: `import { useEffect, useState } from 'react'

export interface Result {
  id: string
  title: string
}

export function useSearch(query: string, filters: { tags: string[] }) {
  const [results, setResults] = useState<Result[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)

    fetch('/api/search?q=' + query + '&tags=' + filters.tags)
      .then((response) => response.json())
      .then((data) => {
        setResults(data.results)
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
      })
  }, [query, filters])

  return { results, loading }
}
`,
    },
  ],
  expectedPoints: [
    {
      point:
        'Race condition: responses can arrive out of order, so a slow request for ' +
        '"ca" can overwrite the results for "cat". Needs an AbortController or an ' +
        'ignore flag in the effect cleanup.',
      essential: true,
      weakAnswer:
        'Says "add a debounce". Debouncing reduces how often it happens but does not ' +
        'fix it — two in-flight requests can still resolve in the wrong order.',
    },
    {
      point:
        'The effect has no cleanup, so a request that resolves after unmount still ' +
        'calls setState.',
      essential: true,
    },
    {
      point:
        '`filters` is an object in the dependency array. A caller passing an inline ' +
        'object literal gives a new reference every render, so this refetches on every ' +
        'render — an infinite loop in practice.',
      essential: true,
      weakAnswer: 'Reads the dependency array as correct because `filters` is listed in it.',
    },
    {
      point:
        'Query parameters are not encoded. A query containing & or = corrupts the URL; ' +
        '`URLSearchParams` handles this, and `filters.tags` is being stringified by ' +
        'implicit array coercion.',
      essential: true,
    },
    {
      point:
        '`response.ok` is never checked, so a 500 with an HTML body goes to `.json()` ' +
        'and fails as a parse error rather than a server error.',
    },
    {
      point:
        'The catch swallows the error entirely — the user sees empty results with no ' +
        'indication anything failed, indistinguishable from "no matches".',
      essential: true,
    },
    {
      point:
        'No debounce, so it fires a request per keystroke. Distinct from the race, and ' +
        'worth mentioning separately.',
    },
    {
      point:
        'It fires on mount with an empty query, searching for nothing before the user ' +
        'has typed.',
    },
    {
      point: '`data.results` is assumed to exist and be an array; nothing validates the shape.',
    },
  ],
  hintLadder: [
    'Imagine typing "cat" quickly. How many requests go out, and what order do they come back in?',
    'What happens if the response for "ca" arrives after the response for "cat"?',
    'Now look at the dependency array. What kind of value is `filters`?',
    'What does the user actually see when the request fails?',
  ],
  followUps: [
    'Of everything you listed, which would you fix first?',
    'How would you write a test that reliably reproduces the out-of-order race?',
    'Would moving this to a data-fetching library fix all of these, or just some?',
    'Which of these does the type system catch, and which does it not?',
  ],
  rubric: DISCUSSION_RUBRIC['code-review'],
}
