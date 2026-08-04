import type { WorkspaceProblem } from '@/lib/problems/types'
import { WORKSPACE_RUBRIC } from '@/lib/problems/types'

/**
 * Fullstack: the bug lives at the client/server seam, and neither side is wrong
 * on its own. The client is right to retry a timeout. The server is right to
 * charge when asked. Together they double-charge.
 *
 * The transport is the whole trick — it lets the server process the request and
 * *then* loses the response. That's the failure mode people forget, because a
 * timeout feels like "it didn't happen" when it usually means "I don't know".
 *
 * The candidate has both files open and has to decide which side owns the fix.
 * (It's the server: the client cannot know whether its retry is a duplicate.)
 */
export const idempotentCharge: WorkspaceProblem = {
  kind: 'workspace',
  variant: 'bug-squash',
  slug: 'idempotent-charge',
  title: 'Retries are double-charging customers',
  difficulty: 'medium',
  topics: ['idempotency', 'client/server', 'retries', 'payments'],
  goal: 'A retried request charges twice. Fix it — you own both sides.',
  statement: `Support has three tickets this week from customers charged twice for one
order. The logs show a single click, two charges, and a network timeout in between.

Here's the sequence:

1. The client sends a charge request.
2. The server **processes it** and creates the charge.
3. The response is lost in transit. The client sees a timeout.
4. The client retries — correctly, because from where it stands the request may
   never have arrived.
5. The server charges again.

Neither side is obviously wrong in isolation, which is why this survived review.

**Ground rules**

- You have both \`client\` and \`server\` open. Decide which side should own the fix
  and be ready to say why.
- The transport is read-only — it models the network, and the network really does
  behave like this.
- A retry must return the **same charge**, not just avoid creating a second one.`,
  testPath: { python: 'charge_test.py', typescript: 'charge.test.ts' },
  startingState: 'failing',
  files: {
    python: [
      {
        path: 'server.py',
        content: `class PaymentServer:
    """Creates charges. In-memory; one instance per test."""

    def __init__(self):
        self._charges = []
        self._next_id = 1

    def handle_charge(self, request):
        """request: {idempotency_key, customer_id, amount_cents}"""
        charge = {
            "charge_id": "ch_%d" % self._next_id,
            "customer_id": request["customer_id"],
            "amount_cents": request["amount_cents"],
            "status": "succeeded",
        }
        self._next_id += 1
        self._charges.append(charge)
        return charge

    def total_charged(self, customer_id):
        return sum(c["amount_cents"] for c in self._charges if c["customer_id"] == customer_id)

    def charge_count(self):
        return len(self._charges)
`,
      },
      {
        path: 'client.py',
        content: `from transport import TransportTimeout


def charge_with_retry(transport, request, max_attempts=3):
    """Send a charge, retrying when the response doesn't come back."""
    last_error = None

    for attempt in range(max_attempts):
        try:
            return transport.send(request)
        except TransportTimeout as exc:
            last_error = exc

    raise last_error
`,
      },
      {
        path: 'transport.py',
        readOnly: true,
        content: `class TransportTimeout(Exception):
    """The response never came back. The request may or may not have been handled."""


class LossyTransport:
    """Delivers the request, then loses the first \`drop_responses\` replies.

    This models the failure mode people forget: a timeout does not mean the
    request was not processed. It means you don't know.
    """

    def __init__(self, server, drop_responses=0):
        self._server = server
        self._drop_responses = drop_responses
        self.sends = 0

    def send(self, request):
        self.sends += 1
        response = self._server.handle_charge(request)  # the server really did run

        if self._drop_responses > 0:
            self._drop_responses -= 1
            raise TransportTimeout("response lost")

        return response
`,
      },
      {
        path: 'charge_test.py',
        readOnly: true,
        content: `from client import charge_with_retry
from server import PaymentServer
from transport import LossyTransport


def request(key="idem_1", customer_id="cus_1", amount_cents=2500):
    return {
        "idempotency_key": key,
        "customer_id": customer_id,
        "amount_cents": amount_cents,
    }


def test_a_clean_request_charges_once():
    server = PaymentServer()
    transport = LossyTransport(server)

    response = charge_with_retry(transport, request())

    assert response["status"] == "succeeded"
    assert server.charge_count() == 1
    assert server.total_charged("cus_1") == 2500


def test_different_requests_both_charge():
    server = PaymentServer()
    transport = LossyTransport(server)

    charge_with_retry(transport, request(key="idem_1"))
    charge_with_retry(transport, request(key="idem_2"))

    assert server.charge_count() == 2
    assert server.total_charged("cus_1") == 5000


def test_a_retry_after_a_lost_response_charges_only_once():
    server = PaymentServer()
    transport = LossyTransport(server, drop_responses=1)

    charge_with_retry(transport, request())

    assert transport.sends == 2, "the client should have retried once"
    assert server.charge_count() == 1, (
        "the customer clicked once - expected 1 charge, got %d" % server.charge_count()
    )
    assert server.total_charged("cus_1") == 2500, (
        "expected 2500 charged, got %d" % server.total_charged("cus_1")
    )


def test_a_retry_returns_the_original_charge():
    server = PaymentServer()
    transport = LossyTransport(server, drop_responses=1)

    response = charge_with_retry(transport, request())

    assert response["charge_id"] == "ch_1", (
        "the retry should return the charge that was already created, got %r"
        % response["charge_id"]
    )
`,
      },
    ],
    typescript: [
      {
        path: 'server.ts',
        content: `export interface ChargeRequest {
  idempotencyKey: string
  customerId: string
  amountCents: number
}

export interface Charge {
  chargeId: string
  customerId: string
  amountCents: number
  status: 'succeeded'
}

/** Creates charges. In-memory; one instance per test. */
export class PaymentServer {
  private charges: Charge[] = []
  private nextId = 1

  handleCharge(request: ChargeRequest): Charge {
    const charge: Charge = {
      chargeId: \`ch_\${this.nextId}\`,
      customerId: request.customerId,
      amountCents: request.amountCents,
      status: 'succeeded',
    }
    this.nextId += 1
    this.charges.push(charge)
    return charge
  }

  totalCharged(customerId: string): number {
    return this.charges
      .filter((c) => c.customerId === customerId)
      .reduce((sum, c) => sum + c.amountCents, 0)
  }

  chargeCount(): number {
    return this.charges.length
  }
}
`,
      },
      {
        path: 'client.ts',
        content: `import { TransportTimeout, type Transport } from './transport'
import type { Charge, ChargeRequest } from './server'

/** Send a charge, retrying when the response doesn't come back. */
export function chargeWithRetry(
  transport: Transport,
  request: ChargeRequest,
  maxAttempts = 3,
): Charge {
  let lastError: unknown = null

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return transport.send(request)
    } catch (error) {
      if (!(error instanceof TransportTimeout)) throw error
      lastError = error
    }
  }

  throw lastError
}
`,
      },
      {
        path: 'transport.ts',
        readOnly: true,
        content: `import type { Charge, ChargeRequest, PaymentServer } from './server'

/** The response never came back. The request may or may not have been handled. */
export class TransportTimeout extends Error {}

export interface Transport {
  send(request: ChargeRequest): Charge
  sends: number
}

/**
 * Delivers the request, then loses the first \`dropResponses\` replies.
 *
 * This models the failure mode people forget: a timeout does not mean the
 * request was not processed. It means you don't know.
 */
export class LossyTransport implements Transport {
  sends = 0

  constructor(
    private server: PaymentServer,
    private dropResponses = 0,
  ) {}

  send(request: ChargeRequest): Charge {
    this.sends += 1
    const response = this.server.handleCharge(request) // the server really did run

    if (this.dropResponses > 0) {
      this.dropResponses -= 1
      throw new TransportTimeout('response lost')
    }

    return response
  }
}
`,
      },
      {
        path: 'charge.test.ts',
        readOnly: true,
        content: `import { equal, ok } from 'harness'
import { chargeWithRetry } from './client'
import { PaymentServer, type ChargeRequest } from './server'
import { LossyTransport } from './transport'

function request(
  idempotencyKey = 'idem_1',
  customerId = 'cus_1',
  amountCents = 2500,
): ChargeRequest {
  return { idempotencyKey, customerId, amountCents }
}

export function testACleanRequestChargesOnce() {
  const server = new PaymentServer()
  const transport = new LossyTransport(server)

  const response = chargeWithRetry(transport, request())

  equal(response.status, 'succeeded')
  equal(server.chargeCount(), 1)
  equal(server.totalCharged('cus_1'), 2500)
}

export function testDifferentRequestsBothCharge() {
  const server = new PaymentServer()
  const transport = new LossyTransport(server)

  chargeWithRetry(transport, request('idem_1'))
  chargeWithRetry(transport, request('idem_2'))

  equal(server.chargeCount(), 2)
  equal(server.totalCharged('cus_1'), 5000)
}

export function testARetryAfterALostResponseChargesOnlyOnce() {
  const server = new PaymentServer()
  const transport = new LossyTransport(server, 1)

  chargeWithRetry(transport, request())

  equal(transport.sends, 2, 'the client should have retried once')
  equal(server.chargeCount(), 1, 'the customer clicked once - expected exactly 1 charge')
  equal(server.totalCharged('cus_1'), 2500)
}

export function testARetryReturnsTheOriginalCharge() {
  const server = new PaymentServer()
  const transport = new LossyTransport(server, 1)

  const response = chargeWithRetry(transport, request())

  ok(
    response.chargeId === 'ch_1',
    \`the retry should return the charge already created, got \${response.chargeId}\`,
  )
}
`,
      },
    ],
  },
  referencePatch: {
    python: {
      'server.py': `class PaymentServer:
    """Creates charges, keyed by idempotency key.

    The server owns this fix, not the client: only the server can tell a retry
    from a genuinely new request, because only it knows what it already did.
    """

    def __init__(self):
        self._charges = []
        self._by_key = {}
        self._next_id = 1

    def handle_charge(self, request):
        key = request["idempotency_key"]

        # Replaying the stored response is the point: the caller must end up
        # believing exactly one charge happened, which is also true.
        if key in self._by_key:
            return self._by_key[key]

        charge = {
            "charge_id": "ch_%d" % self._next_id,
            "customer_id": request["customer_id"],
            "amount_cents": request["amount_cents"],
            "status": "succeeded",
        }
        self._next_id += 1
        self._charges.append(charge)
        self._by_key[key] = charge
        return charge

    def total_charged(self, customer_id):
        return sum(c["amount_cents"] for c in self._charges if c["customer_id"] == customer_id)

    def charge_count(self):
        return len(self._charges)
`,
    },
    typescript: {
      'server.ts': `export interface ChargeRequest {
  idempotencyKey: string
  customerId: string
  amountCents: number
}

export interface Charge {
  chargeId: string
  customerId: string
  amountCents: number
  status: 'succeeded'
}

/**
 * Creates charges, keyed by idempotency key.
 *
 * The server owns this fix, not the client: only the server can tell a retry
 * from a genuinely new request, because only it knows what it already did.
 */
export class PaymentServer {
  private charges: Charge[] = []
  private byKey = new Map<string, Charge>()
  private nextId = 1

  handleCharge(request: ChargeRequest): Charge {
    const existing = this.byKey.get(request.idempotencyKey)
    // Replaying the stored response is the point: the caller must end up
    // believing exactly one charge happened, which is also true.
    if (existing) return existing

    const charge: Charge = {
      chargeId: \`ch_\${this.nextId}\`,
      customerId: request.customerId,
      amountCents: request.amountCents,
      status: 'succeeded',
    }
    this.nextId += 1
    this.charges.push(charge)
    this.byKey.set(request.idempotencyKey, charge)
    return charge
  }

  totalCharged(customerId: string): number {
    return this.charges
      .filter((c) => c.customerId === customerId)
      .reduce((sum, c) => sum + c.amountCents, 0)
  }

  chargeCount(): number {
    return this.charges.length
  }
}
`,
    },
  },
  hintLadder: [
    'Trace the failing test through the transport. How many times does the server run?',
    'Can the client tell the difference between "never arrived" and "reply lost"?',
    'If the client cannot know, which side has enough information to decide?',
    'The request already carries an idempotency key. Nothing reads it.',
  ],
  followUps: [
    'Why does the retry need to return the *same* charge rather than just skipping?',
    'What if the same key arrives with a different amount? Which is the safer behaviour?',
    'Two retries arrive at the same instant on two servers. What breaks, and what fixes it?',
    'How long would you keep these keys, and what happens after you expire them?',
  ],
  rubric: WORKSPACE_RUBRIC['bug-squash'],
}
