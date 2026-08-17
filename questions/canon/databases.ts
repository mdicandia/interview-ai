import type { RapidFireSet } from '@/lib/problems/types'

/**
 * Databases, from the canon's own list.
 *
 * The OLTP/OLAP and denormalisation questions are here rather than in a "senior"
 * set because they are the daily work — a warehouse beside a transactional
 * database — and an answer that draws on that reads completely differently from
 * one recited from a definition.
 */
export const databaseFundamentals: RapidFireSet = {
  slug: 'drill-databases',
  title: 'Databases and SQL',
  difficulty: 'medium',
  topics: ['sql', 'databases', 'performance'],
  blurb: 'Indexes, joins, transactions, and the N+1 you are expected to have hunted.',
  seconds: 60,
  questions: [
    {
      id: 'index',
      prompt: 'What is a database index, and what does it cost you?',
      topic: 'indexes',
      expectedPoints: [
        'a separate sorted structure, usually a B-tree, that turns a full scan into a lookup',
        'it speeds up WHERE, JOIN and ORDER BY on the indexed columns',
        'it costs storage and write time — every insert and update maintains it — and it does little on a low-selectivity column',
      ],
    },
    {
      id: 'composite-index',
      prompt: 'You have a composite index on (tenant_id, created_at). Which queries use it?',
      topic: 'indexes',
      expectedPoints: [
        'column order matters: it serves queries filtering on tenant_id, and on tenant_id together with created_at',
        'a query filtering only on created_at cannot use it, because that is not a prefix of the index',
      ],
    },
    {
      id: 'joins',
      prompt: 'Name the join types and what each returns.',
      topic: 'joins',
      expectedPoints: [
        'INNER returns only rows matching on both sides',
        'LEFT returns every row from the left table, with nulls where the right has no match; RIGHT is the mirror',
        'FULL returns everything from both sides, with nulls where either has no match',
      ],
    },
    {
      id: 'n-plus-one',
      prompt: 'What is the N+1 query problem, and how do you fix it?',
      topic: 'performance',
      expectedPoints: [
        'one query fetches a list, then a further query runs per row to fetch a relation — N+1 round trips instead of one or two',
        'it usually comes from an ORM lazily loading a relation inside a loop',
        'fix it by joining, by eager loading the relation, or by batching the second query into one lookup',
      ],
    },
    {
      id: 'acid',
      prompt: 'What does ACID stand for, and give me an example of why you need it.',
      topic: 'transactions',
      expectedPoints: [
        'atomic — all or nothing; consistent — constraints hold at the end; isolated — concurrent transactions do not see each other half-done; durable — a commit survives a crash',
        'a concrete case: an invoice and its line items must commit together, or a transfer must debit and credit as one unit',
      ],
    },
    {
      id: 'where-vs-having',
      prompt: 'WHERE versus HAVING.',
      topic: 'sql',
      expectedPoints: [
        'WHERE filters rows before grouping',
        'HAVING filters groups after GROUP BY, so it can use an aggregate such as COUNT or SUM',
      ],
    },
    {
      id: 'normalization',
      prompt: 'Normalization versus denormalization — when would you deliberately denormalize?',
      topic: 'modelling',
      expectedPoints: [
        'normalizing removes duplication so a fact lives in one place and cannot disagree with itself',
        'denormalizing reintroduces duplication to avoid joins and make reads faster',
        'the trade is integrity against read speed; analytics and reporting are where denormalizing is the normal answer',
      ],
    },
    {
      id: 'oltp-vs-olap',
      prompt: 'OLTP versus OLAP.',
      topic: 'modelling',
      expectedPoints: [
        'OLTP is transactional: many small reads and writes of whole rows, row-stored, normalized',
        'OLAP is analytical: scans and aggregates over few columns of many rows, column-stored, often denormalized',
        'they are separated because one workload starves the other on the same machine',
      ],
    },
    {
      id: 'sql-vs-nosql',
      prompt: 'How do you choose between a relational database and a document store?',
      topic: 'modelling',
      expectedPoints: [
        'choose by access pattern, not by preference — relational for related entities queried many ways, with joins and transactions',
        'a document or key-value store for a flexible schema, high write volume, and access by one known key',
        'say honestly which one you have actually run in production',
      ],
    },
    {
      id: 'transactions-isolation',
      prompt: 'What is a transaction isolation level, and what problem does raising it solve?',
      topic: 'transactions',
      expectedPoints: [
        'it controls what one transaction can see of another that has not committed',
        'a named anomaly it prevents: a dirty read, a non-repeatable read, or a phantom row',
        'higher isolation costs concurrency — more locking or more retries — so it is a trade rather than a free upgrade',
      ],
    },
    {
      id: 'slow-query',
      prompt: 'A query that was fast last month now takes eight seconds. How do you find out why?',
      topic: 'performance',
      expectedPoints: [
        'read the query plan first — EXPLAIN — rather than guessing at the SQL',
        'look for a sequential scan where an index was expected, and for a row-count estimate far from reality',
        'likely causes: the table grew past where the index helped, statistics are stale, or the query is no longer sargable because a column got wrapped in a function',
      ],
    },
  ],
}
