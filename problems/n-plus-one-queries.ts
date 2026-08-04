import type { WorkspaceProblem } from '@/lib/problems/types'
import { WORKSPACE_RUBRIC } from '@/lib/problems/types'

/**
 * The N+1 query problem, made testable by counting queries rather than timing them.
 *
 * That framing is the whole design: the correctness test passes from the start, so
 * nothing *looks* wrong. The only failing test is the one asserting a constant
 * query count — which is exactly how this bug reaches production and then only
 * shows up on the dashboard once the table grows.
 *
 * Python-only: it needs a real database, and Pyodide ships sqlite3.
 */
export const nPlusOneQueries: WorkspaceProblem = {
  kind: 'workspace',
  variant: 'refactor',
  slug: 'n-plus-one-queries',
  title: 'Order summaries hammer the database',
  difficulty: 'medium',
  languages: ['python'],
  topics: ['sql', 'performance', 'n+1'],
  goal: 'The output is right but the query count is not. Fix it without changing results.',
  statement: `The order summary endpoint is correct and slow. At 20 orders nobody noticed;
at 20,000 it times out.

\`order_summaries\` returns one row per completed order — \`(order_id, customer_name,
amount)\`, ordered by order id. The results are right. The problem is *how* it gets
them.

The test connection counts every query it executes. One test asserts that the count
does not grow with the number of orders.

**Ground rules**

- \`catalog.py\` is the only file to change.
- The output must stay byte-for-byte identical, including ordering.
- \`database.py\` shows the schema and the counting connection — read it.`,
  testPath: { python: 'catalog_test.py' },
  startingState: 'failing',
  files: {
    python: [
      {
        path: 'catalog.py',
        content: `def order_summaries(conn):
    """Return [(order_id, customer_name, amount), ...] for completed orders."""
    orders = conn.execute(
        "SELECT id, customer_id, amount FROM orders"
        " WHERE status = 'completed' ORDER BY id"
    ).fetchall()

    summaries = []
    for order_id, customer_id, amount in orders:
        name = conn.execute(
            "SELECT name FROM customers WHERE id = ?", (customer_id,)
        ).fetchone()[0]
        summaries.append((order_id, name, amount))

    return summaries
`,
      },
      {
        path: 'database.py',
        readOnly: true,
        content: `import sqlite3

SCHEMA = """
CREATE TABLE customers (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE orders (
    id          INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    amount      INTEGER NOT NULL,
    status      TEXT NOT NULL
);
"""

CUSTOMERS = [(1, "Ada"), (2, "Grace"), (3, "Linus")]

ORDERS = [
    # id, customer_id, amount, status
    (1, 1, 5000, "completed"),
    (2, 1, 2500, "completed"),
    (3, 2, 7000, "completed"),
    (4, 2, 1000, "cancelled"),
    (5, 3, 900, "completed"),
    (6, 3, 4200, "pending"),
    (7, 1, 1500, "completed"),
]


class CountingConnection:
    """Wraps a connection and counts the queries that go through it.

    Measuring query *count* rather than elapsed time keeps the test
    deterministic — timing assertions are flaky on a busy machine.
    """

    def __init__(self, conn):
        self._conn = conn
        self.query_count = 0

    def execute(self, sql, params=()):
        self.query_count += 1
        return self._conn.execute(sql, params)

    def close(self):
        self._conn.close()


def make_connection():
    conn = sqlite3.connect(":memory:")
    conn.executescript(SCHEMA)
    conn.executemany("INSERT INTO customers (id, name) VALUES (?, ?)", CUSTOMERS)
    conn.executemany(
        "INSERT INTO orders (id, customer_id, amount, status) VALUES (?, ?, ?, ?)",
        ORDERS,
    )
    conn.commit()
    return CountingConnection(conn)
`,
      },
      {
        path: 'catalog_test.py',
        readOnly: true,
        content: `from catalog import order_summaries
from database import make_connection

EXPECTED = [
    (1, "Ada", 5000),
    (2, "Ada", 2500),
    (3, "Grace", 7000),
    (5, "Linus", 900),
    (7, "Ada", 1500),
]


def test_returns_a_summary_per_completed_order():
    conn = make_connection()
    try:
        assert order_summaries(conn) == EXPECTED
    finally:
        conn.close()


def test_excludes_orders_that_are_not_completed():
    conn = make_connection()
    try:
        ids = [order_id for order_id, _name, _amount in order_summaries(conn)]
        assert 4 not in ids, "order 4 is cancelled and must not appear"
        assert 6 not in ids, "order 6 is pending and must not appear"
    finally:
        conn.close()


def test_uses_a_constant_number_of_queries():
    conn = make_connection()
    try:
        order_summaries(conn)
        assert conn.query_count <= 2, (
            "expected the query count not to grow with the number of orders, "
            "but it issued %d queries for 5 orders" % conn.query_count
        )
    finally:
        conn.close()
`,
      },
    ],
  },
  referencePatch: {
    python: {
      'catalog.py': `def order_summaries(conn):
    """Return [(order_id, customer_name, amount), ...] for completed orders.

    One query. Joining in the database beats fetching ids and then looking each
    one up: the round trips are the cost, not the rows.
    """
    rows = conn.execute(
        """
        SELECT o.id, c.name, o.amount
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        WHERE o.status = 'completed'
        ORDER BY o.id
        """
    ).fetchall()

    return [tuple(row) for row in rows]
`,
    },
  },
  hintLadder: [
    'How many queries does this issue for 5 orders? For 5,000?',
    'What is inside the loop, and does it need to be?',
    'The database can do the lookup for you as part of the first query.',
    'One JOIN gives you the order and its customer name in a single round trip.',
  ],
  followUps: [
    'Why count queries in the test instead of measuring elapsed time?',
    'If you had to keep two queries, how would you structure the second one?',
    'An ORM would generate this same pattern by default. How do you catch it before production?',
    'What changes if a customer row can be missing — should the order disappear?',
  ],
  rubric: WORKSPACE_RUBRIC.refactor,
}
