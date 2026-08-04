import type { AlgorithmProblem } from '@/lib/problems/types'
import { DEFAULT_RUBRIC } from '@/lib/problems/types'

export const mergeIntervals: AlgorithmProblem = {
  kind: 'algorithm',
  slug: 'merge-intervals',
  title: 'Merge Intervals',
  difficulty: 'medium',
  topics: ['arrays', 'sorting', 'intervals'],
  entryPoint: { python: 'merge_intervals', typescript: 'mergeIntervals' },
  signatureHint: 'takes an array of [start, end] pairs, returns the merged non-overlapping pairs',
  statement: `Given an array of intervals where \`intervals[i] = [start_i, end_i]\`,
merge all **overlapping** intervals and return the resulting array, sorted by start.

Intervals that merely touch — like \`[1, 4]\` and \`[4, 5]\` — are considered
overlapping and should be merged into \`[1, 5]\`.

**Example**

\`\`\`
[[1,3], [2,6], [8,10], [15,18]]
-> [[1,6], [8,10], [15,18]]
\`\`\`

**Constraints**

- \`0 <= len(intervals) <= 10_000\`
- \`start_i <= end_i\`
- The input is **not** guaranteed to be sorted.`,
  starterCode: {
    python: `def merge_intervals(intervals):
    # intervals: list[list[int]] -> list[list[int]]
    pass
`,
    typescript: `function mergeIntervals(intervals: number[][]): number[][] {
  // merge all overlapping intervals, sorted by start
}
`,
  },
  referenceSolution: {
    python: `def merge_intervals(intervals):
    if not intervals:
        return []
    ordered = sorted(intervals, key=lambda pair: pair[0])
    out = [list(ordered[0])]
    for start, end in ordered[1:]:
        if start <= out[-1][1]:
            out[-1][1] = max(out[-1][1], end)
        else:
            out.append([start, end])
    return out
`,
    typescript: `function mergeIntervals(intervals: number[][]): number[][] {
  if (intervals.length === 0) return []
  const ordered = [...intervals].sort((a, b) => a[0] - b[0])
  const out: number[][] = [[...ordered[0]]]
  for (let i = 1; i < ordered.length; i++) {
    const [start, end] = ordered[i]
    const last = out[out.length - 1]
    if (start <= last[1]) last[1] = Math.max(last[1], end)
    else out.push([start, end])
  }
  return out
}
`,
  },
  tests: [
    {
      name: 'example case',
      args: [
        [
          [1, 3],
          [2, 6],
          [8, 10],
          [15, 18],
        ],
      ],
      expected: [
        [1, 6],
        [8, 10],
        [15, 18],
      ],
    },
    {
      name: 'touching endpoints merge',
      args: [
        [
          [1, 4],
          [4, 5],
        ],
      ],
      expected: [[1, 5]],
    },
    {
      name: 'no overlap at all',
      args: [
        [
          [1, 2],
          [5, 6],
        ],
      ],
      expected: [
        [1, 2],
        [5, 6],
      ],
    },
    { name: 'empty input', args: [[]], expected: [] },
    // Catches solutions that assume the input arrives sorted.
    {
      name: 'unsorted input',
      args: [
        [
          [5, 6],
          [1, 3],
          [2, 4],
        ],
      ],
      expected: [
        [1, 4],
        [5, 6],
      ],
      hidden: true,
    },
    // Catches `last[1] = end` instead of `max(last[1], end)`.
    {
      name: 'interval fully contained in another',
      args: [
        [
          [1, 10],
          [2, 3],
        ],
      ],
      expected: [[1, 10]],
      hidden: true,
    },
    {
      name: 'chain collapses to one',
      args: [
        [
          [1, 4],
          [2, 5],
          [3, 6],
        ],
      ],
      expected: [[1, 6]],
      hidden: true,
    },
  ],
  hintLadder: [
    'Does the order the intervals arrive in matter for your approach?',
    'If they were sorted by start time, what would you only ever need to compare?',
    'Once sorted, you only ever compare the current interval against the last one you kept.',
    'Careful with a fully-contained interval — the merged end is the max of the two ends, not the newer one.',
  ],
  followUps: [
    'What dominates your runtime, the sort or the scan?',
    'Could you do better than O(n log n) if the intervals were already sorted?',
    'How would you handle a stream of intervals arriving one at a time?',
    'What if you needed to insert a single new interval into an already-merged list?',
  ],
  rubric: DEFAULT_RUBRIC,
}
