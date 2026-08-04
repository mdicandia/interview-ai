import type { DiscussionProblem } from '@/lib/problems/types'
import { DISCUSSION_RUBRIC } from '@/lib/problems/types'

/**
 * Scenario questions: diagnosis and system design.
 *
 * Both carry read-only context — a dashboard summary, a requirements brief — so
 * the candidate has something concrete to reason from rather than answering in
 * the abstract. The diagnosis question in particular is designed so the obvious
 * suspect is wrong: the deploy correlates, but the cause is a cache that expired
 * at the same time.
 */

export const diagnosisP99Regression: DiscussionProblem = {
  kind: 'discussion',
  format: 'diagnosis',
  slug: 'diagnosis-p99-regression',
  title: 'p99 tripled after a deploy',
  difficulty: 'hard',
  expectedMinutes: 15,
  topics: ['debugging', 'performance', 'production', 'methodology'],
  statement: `A production incident. No code to read and no console to type into — you
have the observations below and me to ask questions of. Talk through how you would
actually narrow this down.`,
  prompt:
    'You deployed at 14:02. By 14:20 p99 latency on the API had gone from 180ms to ' +
    '600ms, and it has stayed there. p50 is unchanged. How do you work out what happened?',
  context: [
    {
      path: 'observations.md',
      readOnly: true,
      content: `# What we know

- **14:02** — deploy of \`api\` v482 completed (rolling, 12 pods)
- **14:20** — p99 latency alert fires: 180ms -> 600ms
- p50 latency: **unchanged** at ~40ms
- Error rate: **unchanged** (0.02%)
- Request volume: **unchanged**
- CPU and memory on api pods: **normal**, no restarts
- Database CPU: up from ~30% to ~55%
- The v482 diff: a copy change, a new feature behind a flag (off), and a
  dependency bump

## Things you can ask me about

Anything you would actually have access to: dashboards, logs, traces, the diff,
recent changes in other systems, config, cache state, on-call history.

## Ground truth (do not read until you have committed to an approach)

<details>
The deploy is a red herring. A nightly cache-warming job failed at 13:55 for
unrelated reasons, so a large read cache expired and never refilled. Requests
that miss the cache hit the database; that is a minority of traffic, which is
why p50 is flat and p99 is not.
</details>
`,
    },
  ],
  expectedPoints: [
    {
      point:
        'Notices that p50 is unchanged while p99 tripled, and reasons that a subset of ' +
        'requests got much slower rather than everything getting slightly slower.',
      essential: true,
      weakAnswer:
        'Treats it as a uniform slowdown and starts looking for something that would ' +
        'affect every request.',
    },
    {
      point:
        'Treats the deploy as correlation, not proof, and explicitly checks whether ' +
        'anything else changed around the same time.',
      essential: true,
      weakAnswer:
        'Anchors on the deploy immediately and spends the whole time reading the diff.',
    },
    {
      point:
        'Proposes rolling back — or notes that a rollback that does *not* fix it is ' +
        'itself strong evidence.',
      essential: true,
    },
    {
      point:
        'Follows the database signal: DB CPU rose while API CPU did not, pointing ' +
        'downstream rather than at application code.',
      essential: true,
    },
    {
      point:
        'Asks for a breakdown of the slow requests — by endpoint, customer, or region — ' +
        'to find what the slow tail has in common.',
      essential: true,
    },
    {
      point:
        'Reaches for traces or slow-query logs to see where the time is actually spent, ' +
        'rather than guessing.',
    },
    {
      point:
        'Considers cache behaviour as a cause of exactly this signature — a hit/miss ' +
        'split produces a bimodal latency distribution.',
    },
    {
      point:
        'Reviews the dependency bump specifically, as the part of the diff most likely ' +
        'to change behaviour invisibly.',
    },
    {
      point:
        'States a hypothesis and says what evidence would confirm or kill it, rather ' +
        'than listing everything that could theoretically be wrong.',
      essential: true,
    },
    { point: 'Asks what changed in *other* systems, not just this one.' },
  ],
  hintLadder: [
    'What does it tell you that p50 did not move at all?',
    'Which requests are in the p99 — is there anything they have in common?',
    'API CPU is flat but database CPU is up. What does that rule in or out?',
    'What else happens on a schedule around that time of day?',
  ],
  followUps: [
    'You rolled back and it did not help. What does that change?',
    'How would you have caught this before the alert fired?',
    'What would you add to the dashboard so the next person sees it faster?',
    'How do you decide when to stop investigating and mitigate instead?',
  ],
  rubric: DISCUSSION_RUBRIC.diagnosis,
}

export const systemDesignUrlShortener: DiscussionProblem = {
  kind: 'discussion',
  format: 'system-design',
  slug: 'system-design-url-shortener',
  title: 'Design a URL shortener',
  difficulty: 'medium',
  expectedMinutes: 25,
  topics: ['system design', 'data modelling', 'scale', 'caching'],
  statement: `A scoped system design. Deliberately a well-worn problem: the interest is
not novelty, it is whether you establish requirements before designing and whether
you can justify the parts you chose.`,
  prompt:
    'Design a URL shortener. Take it wherever you think is most interesting, but I ' +
    'want to understand the data model and how it behaves under load.',
  context: [
    {
      path: 'brief.md',
      readOnly: true,
      content: `# Brief

Build a service that turns a long URL into a short one, and redirects.

## What the interviewer will supply if asked

- ~100M new links per month
- ~10B redirects per month (roughly 100:1 read/write)
- Links never expire unless explicitly deleted
- Custom aliases are a requirement ("go/launch")
- Analytics (click counts) are wanted, but eventual consistency is fine
- p99 redirect latency target: under 50ms globally

Do not assume these numbers. They are here so the question has a real answer —
you should still ask.
`,
    },
  ],
  expectedPoints: [
    {
      point:
        'Establishes scale and read/write ratio before designing, and lets that shape ' +
        'the architecture rather than designing first and checking later.',
      essential: true,
      weakAnswer: 'Starts drawing boxes immediately without asking a single question.',
    },
    {
      point:
        'Defines the API surface: create (long URL, optional alias) and redirect, with ' +
        'the redirect returning a 301 or 302 — and can say why they picked one.',
      essential: true,
    },
    {
      point:
        'Data model is essentially a key-value mapping short code to long URL, plus ' +
        'metadata. Recognises this does not need a relational schema.',
      essential: true,
    },
    {
      point:
        'Addresses short-code generation: a counter with base62 encoding, random with a ' +
        'uniqueness check, or hashing — and names the trade-off of the one chosen.',
      essential: true,
      weakAnswer:
        'Says "hash the URL" without addressing collisions, or without noticing that ' +
        'hashing makes identical URLs share a code, which may be undesirable.',
    },
    {
      point:
        'Handles the custom alias case as a separate concern with a uniqueness ' +
        'constraint and a reserved-word list.',
    },
    {
      point:
        'Reads dominate 100:1, so caching is central — a cache in front of the store, ' +
        'and a CDN or edge layer for the global latency target.',
      essential: true,
    },
    {
      point:
        'Notes that the mapping is immutable once created, which makes it unusually ' +
        'cache-friendly — long TTLs, no invalidation problem.',
    },
    {
      point:
        'Analytics are decoupled from the redirect path: fire-and-forget or a queue, so ' +
        'counting a click never slows or breaks the redirect.',
      essential: true,
    },
    {
      point:
        'Discusses partitioning or sharding by short code once the dataset outgrows one ' +
        'node.',
    },
    {
      point:
        'Raises failure modes: what happens on a cache miss storm, or if the analytics ' +
        'pipeline is down.',
    },
    {
      point:
        'Mentions abuse — shortened links are used for phishing — even briefly, as a ' +
        'real operational concern.',
    },
  ],
  hintLadder: [
    'Before designing anything, what would you want to know?',
    'How do you generate the short code, and what breaks if two requests collide?',
    'Reads outnumber writes 100 to 1. What does that let you do?',
    'Where do the click counts get written, and what happens if that write fails?',
  ],
  followUps: [
    'You chose a 301 — what happens when someone wants to delete a link afterwards?',
    'How would you support link expiry if the product asked for it next quarter?',
    'One customer sends 90% of the traffic to a single link. Does anything break?',
    'What is the first thing that falls over if traffic goes up 10x overnight?',
  ],
  rubric: DISCUSSION_RUBRIC['system-design'],
}
