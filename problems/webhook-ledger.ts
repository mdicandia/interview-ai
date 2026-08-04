import type { WorkspaceProblem } from '@/lib/problems/types'
import { WORKSPACE_RUBRIC } from '@/lib/problems/types'

/**
 * Data wrangling. The starting code is a plausible first pass that handles the
 * happy path — the shape of code that's actually in production somewhere until
 * the first duplicate webhook arrives.
 *
 * Four of seven tests pass initially. The three failures are the three things
 * that make real webhook streams hard: at-least-once delivery, arrival order not
 * matching event order, and events that arrive after the entity is gone.
 */
export const webhookLedger: WorkspaceProblem = {
  kind: 'workspace',
  variant: 'data',
  slug: 'webhook-ledger',
  title: 'Reconcile webhook events into balances',
  difficulty: 'medium',
  topics: ['data modelling', 'idempotency', 'edge cases'],
  goal: 'Three tests are failing. Make the reconciler handle real webhook delivery.',
  statement: `We receive payment webhooks and need to reconcile them into a balance
per account. The current implementation works on clean input and falls apart on
real traffic.

Webhook delivery gives us three guarantees we have to design around:

- **At-least-once delivery** — the same event can arrive more than once, with the
  same \`id\`.
- **No ordering guarantee** — events arrive in any order. \`sequence\` is the true
  order they occurred in.
- **Late events** — an event can arrive after the account has been closed.

**Event shape**

\`\`\`
{ "id": "evt_1", "sequence": 1, "type": "charge.succeeded",
  "account": "acct_a", "amount": 500 }
\`\`\`

**Rules**

| Type | Effect |
|---|---|
| \`charge.succeeded\` | add \`amount\` |
| \`refund.created\` | subtract \`amount\` |
| \`charge.failed\` | no change, but the account still appears |
| \`account.closed\` | the account is closed; later events for it are ignored |

Amounts are integer cents. Every account mentioned by a processed event appears in
the result, even if its balance is zero. A closed account keeps its final balance.`,
  testPath: { python: 'ledger_test.py', typescript: 'ledger.test.ts' },
  startingState: 'failing',
  files: {
    python: [
      {
        path: 'ledger.py',
        content: `def reconcile(events):
    """Fold a list of webhook events into {account_id: balance_in_cents}."""
    balances = {}

    for event in events:
        account = event["account"]
        if account not in balances:
            balances[account] = 0

        if event["type"] == "charge.succeeded":
            balances[account] += event["amount"]
        elif event["type"] == "refund.created":
            balances[account] -= event["amount"]

    return balances
`,
      },
      {
        path: 'ledger_test.py',
        readOnly: true,
        content: `from ledger import reconcile


def event(id, sequence, type, account="acct_a", amount=0):
    return {
        "id": id,
        "sequence": sequence,
        "type": type,
        "account": account,
        "amount": amount,
    }


def test_sums_successful_charges():
    events = [
        event("evt_1", 1, "charge.succeeded", amount=500),
        event("evt_2", 2, "charge.succeeded", amount=250),
    ]
    assert reconcile(events) == {"acct_a": 750}


def test_subtracts_refunds():
    events = [
        event("evt_1", 1, "charge.succeeded", amount=1000),
        event("evt_2", 2, "refund.created", amount=300),
    ]
    assert reconcile(events) == {"acct_a": 700}


def test_ignores_failed_charges():
    events = [
        event("evt_1", 1, "charge.succeeded", amount=500),
        event("evt_2", 2, "charge.failed", amount=900),
    ]
    assert reconcile(events) == {"acct_a": 500}


def test_returns_zero_for_an_account_with_no_money_movement():
    events = [event("evt_1", 1, "charge.failed", account="acct_b", amount=500)]
    assert reconcile(events) == {"acct_b": 0}


def test_ignores_duplicate_deliveries():
    duplicate = event("evt_1", 1, "charge.succeeded", amount=500)
    result = reconcile([duplicate, dict(duplicate)])
    assert result == {"acct_a": 500}, (
        "the same event id delivered twice should only count once, got %r" % result
    )


def test_ignores_events_after_the_account_is_closed():
    events = [
        event("evt_1", 1, "charge.succeeded", amount=500),
        event("evt_2", 2, "account.closed"),
        event("evt_3", 3, "charge.succeeded", amount=900),
    ]
    result = reconcile(events)
    assert result == {"acct_a": 500}, (
        "charges after account.closed should be dropped, got %r" % result
    )


def test_applies_events_in_sequence_order_not_arrival_order():
    # Same three events as above, delivered back to front.
    events = [
        event("evt_3", 3, "charge.succeeded", amount=900),
        event("evt_2", 2, "account.closed"),
        event("evt_1", 1, "charge.succeeded", amount=500),
    ]
    result = reconcile(events)
    assert result == {"acct_a": 500}, (
        "sequence is the real order - arrival order should not change the answer, got %r"
        % result
    )
`,
      },
    ],
    typescript: [
      {
        path: 'ledger.ts',
        content: `export interface LedgerEvent {
  id: string
  sequence: number
  type: string
  account: string
  amount: number
}

/** Fold a list of webhook events into { accountId: balanceInCents }. */
export function reconcile(events: LedgerEvent[]): Record<string, number> {
  const balances: Record<string, number> = {}

  for (const event of events) {
    if (!(event.account in balances)) balances[event.account] = 0

    if (event.type === 'charge.succeeded') {
      balances[event.account] += event.amount
    } else if (event.type === 'refund.created') {
      balances[event.account] -= event.amount
    }
  }

  return balances
}
`,
      },
      {
        path: 'ledger.test.ts',
        readOnly: true,
        content: `import { deepEqual } from 'harness'
import { reconcile, type LedgerEvent } from './ledger'

function event(
  id: string,
  sequence: number,
  type: string,
  { account = 'acct_a', amount = 0 }: { account?: string; amount?: number } = {},
): LedgerEvent {
  return { id, sequence, type, account, amount }
}

export function testSumsSuccessfulCharges() {
  deepEqual(
    reconcile([
      event('evt_1', 1, 'charge.succeeded', { amount: 500 }),
      event('evt_2', 2, 'charge.succeeded', { amount: 250 }),
    ]),
    { acct_a: 750 },
  )
}

export function testSubtractsRefunds() {
  deepEqual(
    reconcile([
      event('evt_1', 1, 'charge.succeeded', { amount: 1000 }),
      event('evt_2', 2, 'refund.created', { amount: 300 }),
    ]),
    { acct_a: 700 },
  )
}

export function testIgnoresFailedCharges() {
  deepEqual(
    reconcile([
      event('evt_1', 1, 'charge.succeeded', { amount: 500 }),
      event('evt_2', 2, 'charge.failed', { amount: 900 }),
    ]),
    { acct_a: 500 },
  )
}

export function testReturnsZeroForAnAccountWithNoMoneyMovement() {
  deepEqual(
    reconcile([event('evt_1', 1, 'charge.failed', { account: 'acct_b', amount: 500 })]),
    { acct_b: 0 },
  )
}

export function testIgnoresDuplicateDeliveries() {
  const duplicate = event('evt_1', 1, 'charge.succeeded', { amount: 500 })
  deepEqual(
    reconcile([duplicate, { ...duplicate }]),
    { acct_a: 500 },
    'the same event id delivered twice should only count once',
  )
}

export function testIgnoresEventsAfterTheAccountIsClosed() {
  deepEqual(
    reconcile([
      event('evt_1', 1, 'charge.succeeded', { amount: 500 }),
      event('evt_2', 2, 'account.closed'),
      event('evt_3', 3, 'charge.succeeded', { amount: 900 }),
    ]),
    { acct_a: 500 },
    'charges after account.closed should be dropped',
  )
}

export function testAppliesEventsInSequenceOrderNotArrivalOrder() {
  // Same three events as above, delivered back to front.
  deepEqual(
    reconcile([
      event('evt_3', 3, 'charge.succeeded', { amount: 900 }),
      event('evt_2', 2, 'account.closed'),
      event('evt_1', 1, 'charge.succeeded', { amount: 500 }),
    ]),
    { acct_a: 500 },
    'sequence is the real order - arrival order should not change the answer',
  )
}
`,
      },
    ],
  },
  referencePatch: {
    python: {
      'ledger.py': `def reconcile(events):
    """Fold a list of webhook events into {account_id: balance_in_cents}."""
    balances = {}
    closed = set()
    seen = set()

    for event in sorted(events, key=lambda e: e["sequence"]):
        if event["id"] in seen:
            continue
        seen.add(event["id"])

        account = event["account"]
        if account in closed:
            continue

        balances.setdefault(account, 0)

        kind = event["type"]
        if kind == "charge.succeeded":
            balances[account] += event["amount"]
        elif kind == "refund.created":
            balances[account] -= event["amount"]
        elif kind == "account.closed":
            closed.add(account)

    return balances
`,
    },
    typescript: {
      'ledger.ts': `export interface LedgerEvent {
  id: string
  sequence: number
  type: string
  account: string
  amount: number
}

export function reconcile(events: LedgerEvent[]): Record<string, number> {
  const balances: Record<string, number> = {}
  const closed = new Set<string>()
  const seen = new Set<string>()

  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    if (seen.has(event.id)) continue
    seen.add(event.id)

    if (closed.has(event.account)) continue

    if (!(event.account in balances)) balances[event.account] = 0

    if (event.type === 'charge.succeeded') {
      balances[event.account] += event.amount
    } else if (event.type === 'refund.created') {
      balances[event.account] -= event.amount
    } else if (event.type === 'account.closed') {
      closed.add(event.account)
    }
  }

  return balances
}
`,
    },
  },
  hintLadder: [
    'Look at the three failing test names — what do they have in common?',
    'The events arrive in a list. Is the order of that list the order things happened?',
    'What do you need to remember across the loop that you are not remembering now?',
    'You need three pieces of state: the running balances, the ids already applied, and which accounts are closed.',
  ],
  followUps: [
    'What happens if the same event id arrives with *different* data? Which one wins?',
    'This holds every id in memory. What breaks at a billion events, and what would you do instead?',
    'Should reopening a closed account be possible? How would that change the model?',
    'Amounts are integer cents here. What goes wrong if they were floats?',
  ],
  rubric: WORKSPACE_RUBRIC.data,
}
