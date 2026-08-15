import type { WorkspaceProblem } from '@/lib/problems/types'
import { WORKSPACE_RUBRIC } from '@/lib/problems/types'

/**
 * The first AI-engineering problem, and deliberately not about calling a model.
 *
 * Anyone can call an embeddings endpoint. What separates people who ship
 * retrieval that works from people who ship retrieval that looks like it works is
 * the boring layer underneath it, and all three bugs here are ones that produce
 * *plausible* results rather than obviously wrong ones — which is exactly why
 * they survive into production:
 *
 * 1. Cosine similarity implemented as a bare dot product. Ranking is then driven
 *    by vector magnitude, so longer chunks win regardless of what they say.
 * 2. Ties broken arbitrarily, so `top_k` is not stable and the same query
 *    returns different citations on different runs.
 * 3. Chunks overlapping by a whole stride, so the same sentence is indexed twice
 *    and fills the results with near-duplicates.
 *
 * No numpy, no model, no network: vectors are given. The exercise is the
 * arithmetic and the edge cases, which is where retrieval quality actually goes.
 */
export const embeddingSearch: WorkspaceProblem = {
  kind: 'workspace',
  variant: 'bug-squash',
  slug: 'embedding-search',
  title: 'Retrieval is returning the wrong chunks',
  difficulty: 'hard',
  topics: ['retrieval', 'embeddings', 'ranking', 'AI engineering'],
  goal: 'Four tests are failing. Make retrieval rank and chunk correctly.',
  statement: `We built a small retrieval layer over a document store. It works well
enough in the demo and badly in production: answers cite the wrong passages, the
same passage twice, and the citations change between identical runs.

Three things are wrong, and all three produce results that *look* reasonable.

**\`similarity(a, b)\`** is supposed to be cosine similarity — the angle between
two vectors, ignoring how long they are. It is currently a plain dot product, so
a chunk scores higher simply for having a larger magnitude. Longer passages beat
better ones.

**\`top_k(query, documents, k)\`** must be deterministic. When two chunks score
equally it currently returns whichever the sort happened to put first, so the same
question cites different sources on different runs. Break ties by the document's
\`id\`, ascending.

**\`chunk(text, size, overlap)\`** splits a document into overlapping windows of
words. The overlap is wrong: consecutive chunks currently repeat far more than
asked, so the index is full of near-duplicates. A window of \`size\` words should
advance by \`size - overlap\` words each time.

The test suite covers all three. Everything is plain arithmetic — there is no
model and no network here.`,
  testPath: { python: 'retrieval_test.py', typescript: 'retrieval.test.ts' },
  startingState: 'failing',
  files: {
    python: [
      {
        path: 'retrieval.py',
        content: `import math


def similarity(a, b):
    """How close two embedding vectors are. Higher is more similar."""
    return sum(x * y for x, y in zip(a, b))


def top_k(query, documents, k):
    """The k most similar documents to the query vector.

    Each document is {"id": str, "vector": list[float]}.
    Returns a list of ids, most similar first.
    """
    scored = [(similarity(query, doc["vector"]), doc["id"]) for doc in documents]
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [doc_id for _, doc_id in scored[:k]]


def chunk(text, size, overlap):
    """Split text into overlapping windows of \`size\` words."""
    words = text.split()
    chunks = []
    start = 0
    while start < len(words):
        chunks.append(" ".join(words[start:start + size]))
        start += size - overlap * 2
    return chunks
`,
      },
      {
        path: 'retrieval_test.py',
        readOnly: true,
        content: `import math

from retrieval import chunk, similarity, top_k


def close(a, b):
    return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9)


def test_identical_direction_scores_one():
    assert close(similarity([1.0, 0.0], [1.0, 0.0]), 1.0)


def test_orthogonal_vectors_score_zero():
    assert close(similarity([1.0, 0.0], [0.0, 1.0]), 0.0)


def test_magnitude_does_not_change_similarity():
    # The same direction, ten times longer. Cosine ignores length.
    assert close(similarity([1.0, 1.0], [10.0, 10.0]), 1.0)


def test_a_longer_vector_does_not_outrank_a_closer_one():
    query = [1.0, 0.0]
    documents = [
        {"id": "far_but_long", "vector": [3.0, 3.0]},
        {"id": "near", "vector": [1.0, 0.0]},
    ]
    assert top_k(query, documents, 1) == ["near"]


def test_ties_break_by_id():
    query = [1.0, 0.0]
    documents = [
        {"id": "b", "vector": [1.0, 0.0]},
        {"id": "a", "vector": [1.0, 0.0]},
        {"id": "c", "vector": [1.0, 0.0]},
    ]
    assert top_k(query, documents, 2) == ["a", "b"]


def test_returns_every_document_when_k_exceeds_the_store():
    query = [1.0, 0.0]
    documents = [{"id": "only", "vector": [1.0, 0.0]}]
    assert top_k(query, documents, 5) == ["only"]


def test_chunks_advance_by_size_minus_overlap():
    text = "one two three four five six"
    assert chunk(text, 3, 1) == ["one two three", "three four five", "five six"]


def test_chunks_without_overlap_do_not_repeat():
    text = "one two three four"
    assert chunk(text, 2, 0) == ["one two", "three four"]
`,
      },
    ],
    typescript: [
      {
        path: 'retrieval.ts',
        content: `export interface Document {
  id: string
  vector: number[]
}

/** How close two embedding vectors are. Higher is more similar. */
export function similarity(a: number[], b: number[]): number {
  return a.reduce((total, value, i) => total + value * b[i], 0)
}

/** The k most similar documents to the query vector, most similar first. */
export function topK(query: number[], documents: Document[], k: number): string[] {
  const scored = documents.map((doc) => ({ id: doc.id, score: similarity(query, doc.vector) }))
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k).map((entry) => entry.id)
}

/** Split text into overlapping windows of \`size\` words. */
export function chunk(text: string, size: number, overlap: number): string[] {
  const words = text.split(/\\s+/).filter(Boolean)
  const chunks: string[] = []
  let start = 0
  while (start < words.length) {
    chunks.push(words.slice(start, start + size).join(' '))
    start += size - overlap * 2
  }
  return chunks
}
`,
      },
      {
        path: 'retrieval.test.ts',
        readOnly: true,
        content: `import { deepEqual, ok } from 'harness'
import { chunk, similarity, topK } from './retrieval'

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9

export function testIdenticalDirectionScoresOne() {
  ok(close(similarity([1, 0], [1, 0]), 1), 'identical direction should score 1')
}

export function testOrthogonalVectorsScoreZero() {
  ok(close(similarity([1, 0], [0, 1]), 0), 'orthogonal vectors should score 0')
}

export function testMagnitudeDoesNotChangeSimilarity() {
  // The same direction, ten times longer. Cosine ignores length.
  ok(close(similarity([1, 1], [10, 10]), 1), 'length should not change the score')
}

export function testALongerVectorDoesNotOutrankACloserOne() {
  const documents = [
    { id: 'far_but_long', vector: [3, 3] },
    { id: 'near', vector: [1, 0] },
  ]
  deepEqual(topK([1, 0], documents, 1), ['near'])
}

export function testTiesBreakById() {
  const documents = [
    { id: 'b', vector: [1, 0] },
    { id: 'a', vector: [1, 0] },
    { id: 'c', vector: [1, 0] },
  ]
  deepEqual(topK([1, 0], documents, 2), ['a', 'b'])
}

export function testReturnsEveryDocumentWhenKExceedsTheStore() {
  deepEqual(topK([1, 0], [{ id: 'only', vector: [1, 0] }], 5), ['only'])
}

export function testChunksAdvanceBySizeMinusOverlap() {
  deepEqual(chunk('one two three four five six', 3, 1), [
    'one two three',
    'three four five',
    'five six',
  ])
}

export function testChunksWithoutOverlapDoNotRepeat() {
  deepEqual(chunk('one two three four', 2, 0), ['one two', 'three four'])
}
`,
      },
    ],
  },
  referencePatch: {
    python: {
      'retrieval.py': `import math


def similarity(a, b):
    """How close two embedding vectors are. Higher is more similar."""
    dot = sum(x * y for x, y in zip(a, b))
    magnitude = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    if magnitude == 0:
        return 0.0
    return dot / magnitude


def top_k(query, documents, k):
    """The k most similar documents to the query vector.

    Each document is {"id": str, "vector": list[float]}.
    Returns a list of ids, most similar first.
    """
    scored = [(similarity(query, doc["vector"]), doc["id"]) for doc in documents]
    # Ascending id as the tie-break, so identical scores order the same way
    # every run rather than however the sort happened to land.
    scored.sort(key=lambda pair: (-pair[0], pair[1]))
    return [doc_id for _, doc_id in scored[:k]]


def chunk(text, size, overlap):
    """Split text into overlapping windows of \`size\` words."""
    words = text.split()
    chunks = []
    stride = max(size - overlap, 1)
    start = 0
    while start < len(words):
        chunks.append(" ".join(words[start:start + size]))
        start += stride
    return chunks
`,
    },
    typescript: {
      'retrieval.ts': `export interface Document {
  id: string
  vector: number[]
}

/** How close two embedding vectors are. Higher is more similar. */
export function similarity(a: number[], b: number[]): number {
  const dot = a.reduce((total, value, i) => total + value * b[i], 0)
  const magnitude =
    Math.sqrt(a.reduce((total, value) => total + value * value, 0)) *
    Math.sqrt(b.reduce((total, value) => total + value * value, 0))
  return magnitude === 0 ? 0 : dot / magnitude
}

/** The k most similar documents to the query vector, most similar first. */
export function topK(query: number[], documents: Document[], k: number): string[] {
  const scored = documents.map((doc) => ({ id: doc.id, score: similarity(query, doc.vector) }))
  // Ascending id as the tie-break, so identical scores order the same way every
  // run rather than however the sort happened to land.
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  return scored.slice(0, k).map((entry) => entry.id)
}

/** Split text into overlapping windows of \`size\` words. */
export function chunk(text: string, size: number, overlap: number): string[] {
  const words = text.split(/\\s+/).filter(Boolean)
  const chunks: string[] = []
  const stride = Math.max(size - overlap, 1)
  let start = 0
  while (start < words.length) {
    chunks.push(words.slice(start, start + size).join(' '))
    start += stride
  }
  return chunks
}
`,
    },
  },
  hintLadder: [
    'Take the failures one at a time. Which of the three functions does each one accuse?',
    'Write down what cosine similarity is as a formula, then compare it against what the code computes.',
    'Two documents with the same score: what decides which comes first today, and is that something you can rely on?',
    'Work out by hand what `chunk("one two three four five six", 3, 1)` should produce, then trace what the loop actually does with `start`.',
    'Cosine is the dot product divided by both magnitudes; the stride is `size - overlap`, not `size - overlap * 2`.',
  ],
  followUps: [
    'What happens to your similarity function if a vector is all zeros?',
    'Retrieval quality is still poor after this. How would you find out whether the problem is chunking, embedding, or ranking?',
    'How would you measure whether a change to chunk size actually helped, without reading answers by hand?',
    'At a million documents, which part of this stops working first, and what replaces it?',
  ],
  rubric: WORKSPACE_RUBRIC['bug-squash'],
}
