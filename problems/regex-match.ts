import type { AlgorithmProblem } from '@/lib/problems/types'
import { DEFAULT_RUBRIC } from '@/lib/problems/types'

/**
 * The bank's first genuinely hard algorithm, and deliberately a recursive one.
 *
 * Every other algorithm here yields to a single well-known trick — a hash map, a
 * sliding window, a sort. This one does not: the `*` case has to consider both
 * consuming a character and consuming none, and seeing that is the whole problem.
 * Someone who reaches for a loop will get part way and stall, which is a much
 * more useful thing to happen in practice than in a real loop.
 *
 * A boolean answer keeps the comparison trivial, so nothing about the exercise
 * turns on output formatting.
 */
export const regexMatch: AlgorithmProblem = {
  kind: 'algorithm',
  slug: 'regex-match',
  title: 'Regular expression matching',
  difficulty: 'hard',
  topics: ['recursion', 'dynamic programming', 'strings'],
  entryPoint: { python: 'is_match', typescript: 'isMatch' },
  signatureHint: 'takes an input string and a pattern, returns whether the pattern matches the whole string',
  statement: `Implement regular expression matching with support for \`.\` and \`*\`.

- \`.\` matches any single character.
- \`*\` matches **zero or more** of the element immediately before it.

The match must cover the **entire** input string, not a substring of it.

**Examples**

\`\`\`
is_match("aa", "a")      -> false    "a" does not cover "aa"
is_match("aa", "a*")     -> true     "a*" is one or more a's
is_match("ab", ".*")     -> true     ".*" is any sequence
is_match("mississippi", "mis*is*p*.") -> false
\`\`\`

**Constraints**

- The input string contains only lowercase letters.
- The pattern contains lowercase letters, \`.\` and \`*\`.
- A \`*\` always has a valid element before it — the pattern never starts with one.
- Both strings are at most 30 characters.`,
  starterCode: {
    python: `def is_match(text, pattern):
    # text: str, pattern: str -> bool
    pass
`,
    typescript: `function isMatch(text: string, pattern: string): boolean {
  // does pattern match the whole of text?
}
`,
  },
  referenceSolution: {
    python: `def is_match(text, pattern):
    memo = {}

    def solve(i, j):
        if (i, j) in memo:
            return memo[(i, j)]

        if j == len(pattern):
            result = i == len(text)
        else:
            first = i < len(text) and pattern[j] in (text[i], ".")
            if j + 1 < len(pattern) and pattern[j + 1] == "*":
                # Either skip the element entirely, or consume one character
                # and stay on the same pattern position.
                result = solve(i, j + 2) or (first and solve(i + 1, j))
            else:
                result = first and solve(i + 1, j + 1)

        memo[(i, j)] = result
        return result

    return solve(0, 0)
`,
    typescript: `function isMatch(text: string, pattern: string): boolean {
  const memo = new Map<string, boolean>()

  const solve = (i: number, j: number): boolean => {
    const key = \`\${i},\${j}\`
    const cached = memo.get(key)
    if (cached !== undefined) return cached

    let result: boolean
    if (j === pattern.length) {
      result = i === text.length
    } else {
      const first = i < text.length && (pattern[j] === text[i] || pattern[j] === '.')
      if (j + 1 < pattern.length && pattern[j + 1] === '*') {
        result = solve(i, j + 2) || (first && solve(i + 1, j))
      } else {
        result = first && solve(i + 1, j + 1)
      }
    }

    memo.set(key, result)
    return result
  }

  return solve(0, 0)
}
`,
  },
  tests: [
    { name: 'a literal that is too short', args: ['aa', 'a'], expected: false },
    { name: 'star repeats the element', args: ['aa', 'a*'], expected: true },
    { name: 'dot star matches anything', args: ['ab', '.*'], expected: true },
    { name: 'star can match zero of the element', args: ['aab', 'c*a*b'], expected: true },
    { name: 'must cover the whole string', args: ['mississippi', 'mis*is*p*.'], expected: false },
    { name: 'empty string against an empty pattern', args: ['', ''], expected: true, hidden: true },
    { name: 'empty string against a star', args: ['', 'a*'], expected: true, hidden: true },
    { name: 'empty pattern cannot match text', args: ['abc', ''], expected: false, hidden: true },
    {
      name: 'a star that must not be greedy',
      args: ['mississippi', 'mis*is*ip*.'],
      expected: true,
      hidden: true,
    },
    { name: 'trailing star matching nothing', args: ['ab', '.*c'], expected: false, hidden: true },
    {
      name: 'many stars, no match',
      args: ['aaaaaaaaaaaaab', 'a*a*a*a*a*a*a*a*a*a*c'],
      expected: false,
      hidden: true,
    },
  ],
  hintLadder: [
    'Start with the simplest version: if there were no stars at all, how would you match?',
    'Look at the first character of each string. When does a match at position zero tell you anything?',
    'A star applies to the element *before* it, so you have to look one character ahead in the pattern before deciding what to do with the current one.',
    'When you see `x*`, there are two independent possibilities: it matches zero characters, or it matches one and you try again with the same pattern.',
    'That branching repeats the same (text index, pattern index) pairs over and over. Cache the answer for each pair.',
  ],
  followUps: [
    'What is the time complexity of your solution, and what makes it that?',
    'Without memoisation, what input makes the recursion blow up?',
    'How would you add support for `+`, meaning one or more?',
    'How would you turn this into a bottom-up table instead of recursion?',
  ],
  rubric: DEFAULT_RUBRIC,
}
