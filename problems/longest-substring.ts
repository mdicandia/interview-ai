import type { AlgorithmProblem } from '@/lib/problems/types'
import { DEFAULT_RUBRIC } from '@/lib/problems/types'

export const longestSubstring: AlgorithmProblem = {
  kind: 'algorithm',
  slug: 'longest-substring',
  title: 'Longest Substring Without Repeating Characters',
  difficulty: 'medium',
  topics: ['strings', 'sliding window', 'hash maps'],
  entryPoint: {
    python: 'length_of_longest_substring',
    typescript: 'lengthOfLongestSubstring',
  },
  signatureHint: 'takes a string, returns an integer length',
  statement: `Given a string \`s\`, return the **length of the longest substring**
that contains no repeated characters.

A *substring* is contiguous — \`"abc"\` is a substring of \`"abcd"\`, but \`"acd"\` is not.

**Examples**

\`\`\`
"abcabcbb"  -> 3    ("abc")
"bbbbb"     -> 1    ("b")
"pwwkew"    -> 3    ("wke", not "pwke" — that is a subsequence)
\`\`\`

**Constraints**

- \`0 <= len(s) <= 50_000\`
- \`s\` may contain letters, digits, symbols, and spaces.`,
  starterCode: {
    python: `def length_of_longest_substring(s):
    # s: str -> int
    pass
`,
    typescript: `function lengthOfLongestSubstring(s: string): number {
  // return the length of the longest substring with all-unique characters
}
`,
  },
  referenceSolution: {
    python: `def length_of_longest_substring(s):
    last_seen = {}
    start = 0
    best = 0
    for i, ch in enumerate(s):
        if ch in last_seen and last_seen[ch] >= start:
            start = last_seen[ch] + 1
        last_seen[ch] = i
        best = max(best, i - start + 1)
    return best
`,
    typescript: `function lengthOfLongestSubstring(s: string): number {
  const lastSeen = new Map<string, number>()
  let start = 0
  let best = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    const prev = lastSeen.get(ch)
    if (prev !== undefined && prev >= start) start = prev + 1
    lastSeen.set(ch, i)
    best = Math.max(best, i - start + 1)
  }
  return best
}
`,
  },
  tests: [
    { name: 'example: abcabcbb', args: ['abcabcbb'], expected: 3 },
    { name: 'all identical', args: ['bbbbb'], expected: 1 },
    { name: 'subsequence trap', args: ['pwwkew'], expected: 3 },
    { name: 'empty string', args: [''], expected: 0 },
    { name: 'single character', args: ['a'], expected: 1, hidden: true },
    { name: 'spaces and symbols', args: ['a b!a b!c'], expected: 5, hidden: true },
    // The classic off-by-one: a repeat that appears *before* the window start
    // must not drag the window backwards.
    { name: 'repeat outside window', args: ['abba'], expected: 2, hidden: true },
  ],
  hintLadder: [
    'What does a brute-force version look like, and what does it cost?',
    "You're re-checking the same characters a lot. Could you keep a window instead?",
    'When you hit a character already in your window, where does the window need to start?',
    "Track the last index of each character; on a repeat, move the start to just past it — but never backwards.",
  ],
  followUps: [
    'Walk me through what happens on the input "abba" — where does a naive window break?',
    'What is your space complexity, and does it depend on the input size or the alphabet?',
    'How would you change this to return the substring itself rather than its length?',
    'What if you were allowed at most one repeated character?',
  ],
  rubric: DEFAULT_RUBRIC,
}
