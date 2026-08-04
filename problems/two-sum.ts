import type { AlgorithmProblem } from '@/lib/problems/types'
import { DEFAULT_RUBRIC } from '@/lib/problems/types'

export const twoSum: AlgorithmProblem = {
  kind: 'algorithm',
  slug: 'two-sum',
  title: 'Two Sum',
  difficulty: 'easy',
  topics: ['arrays', 'hash maps'],
  entryPoint: { python: 'two_sum', typescript: 'twoSum' },
  signatureHint: 'takes an array of integers and a target integer, returns a pair of indices',
  statement: `Given an array of integers \`nums\` and an integer \`target\`, return the
**indices of the two numbers** that add up to \`target\`.

You may assume each input has **exactly one** solution, and you may not use the
same element twice. Return the indices in ascending order.

**Example**

\`\`\`
nums = [2, 7, 11, 15], target = 9
-> [0, 1]        because nums[0] + nums[1] == 9
\`\`\`

**Constraints**

- \`2 <= len(nums) <= 10_000\`
- \`-10^9 <= nums[i] <= 10^9\`
- Exactly one valid answer exists.`,
  starterCode: {
    python: `def two_sum(nums, target):
    # nums: list[int], target: int -> list[int] of length 2
    pass
`,
    typescript: `function twoSum(nums: number[], target: number): number[] {
  // return the two indices that sum to target
}
`,
  },
  referenceSolution: {
    python: `def two_sum(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        if target - n in seen:
            return [seen[target - n], i]
        seen[n] = i
    return []
`,
    typescript: `function twoSum(nums: number[], target: number): number[] {
  const seen = new Map<number, number>()
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i]
    if (seen.has(need)) return [seen.get(need)!, i]
    seen.set(nums[i], i)
  }
  return []
}
`,
  },
  tests: [
    { name: 'example case', args: [[2, 7, 11, 15], 9], expected: [0, 1] },
    { name: 'answer at the end', args: [[3, 2, 4], 6], expected: [1, 2] },
    { name: 'duplicate values', args: [[3, 3], 6], expected: [0, 1] },
    { name: 'negative numbers', args: [[-3, 4, 3, 90], 0], expected: [0, 2], hidden: true },
    {
      name: 'answer is the final pair',
      args: [[1, 5, 2, 8, 11, 7, 4], 11],
      expected: [5, 6],
      hidden: true,
    },
  ],
  hintLadder: [
    "What's the time complexity of the approach you're describing?",
    'Is there a way to avoid scanning the rest of the array for every element?',
    "As you walk the array, what would you need to have remembered to know you've found a pair?",
    'A hash map from value to index lets you check for the complement in constant time.',
  ],
  followUps: [
    'What changes if the array is already sorted?',
    'What if there could be multiple valid pairs and you had to return all of them?',
    'How would you handle this if the array were too large to fit in memory?',
    'What if the input could contain floats instead of integers?',
  ],
  rubric: DEFAULT_RUBRIC,
}
