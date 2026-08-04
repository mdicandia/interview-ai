import type { DiscussionProblem } from '@/lib/problems/types'
import { DISCUSSION_RUBRIC } from '@/lib/problems/types'

/**
 * Concept and trade-off questions.
 *
 * Each `expectedPoints` list is written to separate depth from recall: the
 * essential points are what someone who has *used* the thing says, and the rest
 * is what separates a good answer from a complete one. `weakAnswer` captures the
 * plausible-sounding wrong answer, which is what the interviewer should probe.
 */

export const conceptDatabaseIndex: DiscussionProblem = {
  kind: 'discussion',
  format: 'concept',
  slug: 'concept-database-index',
  title: 'What an index actually does',
  difficulty: 'medium',
  expectedMinutes: 10,
  topics: ['databases', 'indexes', 'performance'],
  statement: `A general question about database indexes. No code — talk it through.`,
  prompt:
    'You add an index to a column on a large table. What actually changes — on disk, ' +
    'on reads, and on writes?',
  expectedPoints: [
    {
      point:
        'An index is a separate data structure — usually a B-tree — holding the ' +
        'indexed column(s) plus a pointer back to the row, kept sorted.',
      essential: true,
      weakAnswer: 'Says "it makes queries faster" without describing what is stored.',
    },
    {
      point:
        'Reads that filter or sort on that column can seek in roughly O(log n) instead ' +
        'of scanning every row.',
      essential: true,
    },
    {
      point:
        'Writes get slower: every insert, update of the indexed column, and delete must ' +
        'maintain the index too. Indexes are a read/write trade, not free speed.',
      essential: true,
      weakAnswer: 'Treats indexes as pure upside, or mentions only disk space as the cost.',
    },
    { point: 'It consumes additional disk space, and additional memory when cached.', essential: true },
    {
      point:
        'Column order matters in a composite index: (a, b) serves queries on `a` and on ' +
        '`a AND b`, but generally not on `b` alone.',
    },
    {
      point:
        'A covering index — one containing every column the query needs — lets the ' +
        'database answer from the index alone without touching the table.',
    },
    {
      point:
        'The planner may ignore the index when it estimates the query matches a large ' +
        'fraction of rows, since a sequential scan is cheaper than many random seeks.',
    },
    {
      point:
        'Wrapping the column in a function (`WHERE lower(email) = ...`) usually defeats ' +
        'the index unless a matching expression index exists.',
    },
    {
      point:
        'Low-cardinality columns (a boolean, a status with three values) benefit little ' +
        'from a plain B-tree index.',
    },
  ],
  hintLadder: [
    'Start concrete: what does the database store on disk when you create it?',
    'Now the other side — what does an INSERT have to do that it did not before?',
    'When would the query planner decide *not* to use an index you have created?',
    'What about an index on two columns — does the order you list them matter?',
  ],
  followUps: [
    'How would you decide whether a specific index is worth keeping?',
    'How do you find indexes nobody is using?',
    'When does adding an index make a query slower rather than faster?',
    'What does adding an index to a 500-million-row table do to a live system?',
  ],
  rubric: DISCUSSION_RUBRIC.concept,
}

export const conceptRequestLifecycle: DiscussionProblem = {
  kind: 'discussion',
  format: 'concept',
  slug: 'concept-request-lifecycle',
  title: 'From click to rendered page',
  difficulty: 'medium',
  expectedMinutes: 15,
  topics: ['networking', 'http', 'browsers', 'breadth'],
  statement: `The classic breadth question. There is no single right answer — the point
is where you choose to go deep, and whether you know where your knowledge stops.`,
  prompt:
    'A user clicks a link to your app and a page appears. Walk me through everything ' +
    'that happens in between. Go as deep as you like anywhere, but cover the whole path.',
  expectedPoints: [
    {
      point:
        'DNS resolution: browser cache, OS cache, resolver, then the authoritative ' +
        'nameserver chain.',
      essential: true,
    },
    {
      point: 'TCP connection, then a TLS handshake for HTTPS before any request is sent.',
      essential: true,
      weakAnswer: 'Jumps straight from DNS to "the server responds", skipping connection setup.',
    },
    {
      point:
        'The HTTP request itself: method, path, headers, cookies. Often reaching a CDN ' +
        'or load balancer before the origin.',
      essential: true,
    },
    {
      point:
        'Server-side handling: routing, auth, database queries, rendering or serialising ' +
        'a response, with caching layers potentially short-circuiting it.',
      essential: true,
    },
    {
      point:
        'The browser parses HTML into the DOM, CSS into the CSSOM, and blocks on ' +
        'synchronous scripts while doing so.',
      essential: true,
    },
    {
      point:
        'Layout, paint, and compositing follow, and subresources (images, fonts, JS) ' +
        'trigger their own requests.',
    },
    {
      point:
        'Mentions caching at several layers — DNS TTL, CDN, HTTP cache headers, the ' +
        'browser cache — rather than treating every step as a cold path.',
    },
    { point: 'Notes that a repeat visit skips much of this, and says which parts.' },
    {
      point:
        'Names their own uncertainty rather than bluffing through a layer they know ' +
        'less well.',
    },
  ],
  hintLadder: [
    'Before any packet is sent — how does the browser know where to send it?',
    'You have an IP address. What happens before the first byte of the request?',
    'The response arrives. What does the browser do with those bytes?',
    'Which parts of what you just described would be skipped on a second visit?',
  ],
  followUps: [
    'Where in that chain would you look first if the page felt slow?',
    'Which step would you expect to dominate the time on a mobile network?',
    'What changes if the page is server-rendered versus a client-side app?',
    'Which of those steps did you feel least sure about?',
  ],
  rubric: DISCUSSION_RUBRIC.concept,
}

export const tradeoffQueueVsDirect: DiscussionProblem = {
  kind: 'discussion',
  format: 'trade-off',
  slug: 'tradeoff-queue-vs-direct',
  title: 'Queue or direct call',
  difficulty: 'medium',
  expectedMinutes: 12,
  topics: ['architecture', 'messaging', 'trade-offs'],
  statement: `A design decision with no universally correct answer. The signal is
whether you ask what the constraints are before choosing, and whether you name the
cost of the option you pick.`,
  prompt:
    'Checkout needs to trigger an invoice being generated. Do you call the invoicing ' +
    'service directly over HTTP, or put a message on a queue? Talk me through it.',
  expectedPoints: [
    {
      point:
        'Asks clarifying questions before answering: does the user need the invoice ' +
        'immediately, how bad is a delay, what is the traffic pattern.',
      essential: true,
      weakAnswer: 'Picks one immediately and defends it without establishing any requirements.',
    },
    {
      point:
        'Direct call gives an immediate answer and simple error handling, but couples ' +
        'checkout availability to invoicing availability.',
      essential: true,
    },
    {
      point:
        'A queue decouples the two: invoicing can be down or slow without failing ' +
        'checkout, and it absorbs traffic spikes.',
      essential: true,
    },
    {
      point:
        'The queue costs you immediacy and simplicity — the caller cannot report ' +
        'success, and you now need to handle failures asynchronously.',
      essential: true,
      weakAnswer: 'Presents the queue as strictly better, with the only cost being "more infra".',
    },
    {
      point:
        'Raises delivery semantics: at-least-once delivery means the consumer must be ' +
        'idempotent, or a retry duplicates the invoice.',
    },
    { point: 'Mentions dead-letter queues or a retry policy for messages that keep failing.' },
    { point: 'Notes that ordering is not guaranteed by default on most queues.' },
    {
      point:
        'Considers the operational cost: a queue is another thing to monitor, with its ' +
        'own failure modes like consumer lag.',
    },
    {
      point: 'Commits to a recommendation with a stated reason rather than "it depends".',
      essential: true,
    },
  ],
  hintLadder: [
    'What would you need to know about the product before choosing?',
    'What happens to checkout if the invoicing service is down for ten minutes?',
    'You picked the queue. What did you just make harder for yourself?',
    'The consumer receives the same message twice. What happens?',
  ],
  followUps: [
    'Where would you put the retry logic in each design?',
    'How would the user find out their invoice failed to generate?',
    'Does your answer change if this is 10 orders a day rather than 10,000?',
    'What would make you revisit this decision later?',
  ],
  rubric: DISCUSSION_RUBRIC['trade-off'],
}
