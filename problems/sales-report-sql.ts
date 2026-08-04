import type { WorkspaceProblem } from '@/lib/problems/types'
import { WORKSPACE_RUBRIC } from '@/lib/problems/types'

/**
 * SQL bug squash against a real SQLite database — Pyodide ships `sqlite3`, so the
 * candidate's query is genuinely planned and executed rather than string-matched.
 *
 * Python-only. Giving TypeScript parity would mean shipping sql.js, a second
 * ~1MB WASM build, for one problem.
 *
 * The planted bug is the classic one: a LEFT JOIN whose right-hand table is
 * filtered in WHERE instead of ON, which silently turns it back into an INNER
 * JOIN and drops every customer with no matching orders. It looks correct, and
 * it's invisible until you check the row count.
 */
export const salesReportSql: WorkspaceProblem = {
  kind: 'workspace',
  variant: 'bug-squash',
  slug: 'sales-report-sql',
  title: 'Sales report is missing customers',
  difficulty: 'medium',
  languages: ['python'],
  topics: ['sql', 'joins', 'debugging'],
  goal: 'Fix the report query. The database and schema are real — run it and look.',
  statement: `Finance says the monthly sales report "looks about right" but the customer
count is lower than the customer list on the dashboard. Nobody has been able to
say which customers are missing.

The report should include **every** customer, with:

- \`total_spent\` — sum of their completed orders in the period, \`0\` if none
- \`order_count\` — number of completed orders in the period, \`0\` if none

**Definitions**

- The period is inclusive of both bounds.
- Only orders with \`status = 'completed'\` count. Cancelled and pending orders
  must not contribute to either column.
- Customers with no qualifying orders still appear, with zeros.
- Results are ordered by \`total_spent\` descending, then \`name\` ascending.

**Ground rules**

- \`report.py\` is the only file to change; \`database.py\` and the tests are read-only.
- The schema and seed data are in \`database.py\` — read it.
- This runs on real SQLite, so you can restructure the query however you like.`,
  testPath: { python: 'report_test.py' },
  startingState: 'failing',
  files: {
    python: [
      {
        path: 'report.py',
        content: `def monthly_sales_report(conn, start_date, end_date):
    """Return [(name, total_spent, order_count), ...] for every customer."""
    rows = conn.execute(
        """
        SELECT c.name,
               COALESCE(SUM(o.amount), 0) AS total_spent,
               COUNT(o.id) AS order_count
        FROM customers c
        LEFT JOIN orders o ON o.customer_id = c.id
        WHERE o.status = 'completed'
          AND o.ordered_on BETWEEN ? AND ?
        GROUP BY c.id, c.name
        ORDER BY total_spent DESC, c.name ASC
        """,
        (start_date, end_date),
    ).fetchall()

    return [tuple(row) for row in rows]
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
    amount      INTEGER NOT NULL,   -- cents
    status      TEXT NOT NULL,      -- 'completed' | 'cancelled' | 'pending'
    ordered_on  TEXT NOT NULL       -- ISO date, e.g. '2026-03-14'
);
"""

CUSTOMERS = [
    (1, "Ada"),
    (2, "Grace"),
    (3, "Linus"),      # no orders at all
    (4, "Margaret"),   # only cancelled orders
]

ORDERS = [
    # id, customer_id, amount, status,      ordered_on
    (1, 1, 5000, "completed", "2026-03-02"),
    (2, 1, 2500, "completed", "2026-03-28"),
    (3, 1, 9900, "completed", "2026-04-01"),   # outside March
    (4, 2, 7000, "completed", "2026-03-15"),
    (5, 2, 1000, "cancelled", "2026-03-16"),
    (6, 2, 4200, "pending",   "2026-03-17"),
    (7, 4, 3300, "cancelled", "2026-03-09"),
    (8, 1, 1500, "completed", "2026-03-01"),   # boundary: first day
    (9, 2, 800,  "completed", "2026-03-31"),   # boundary: last day
]


def make_connection():
    """A fresh in-memory database, seeded identically for every test."""
    conn = sqlite3.connect(":memory:")
    conn.executescript(SCHEMA)
    conn.executemany("INSERT INTO customers (id, name) VALUES (?, ?)", CUSTOMERS)
    conn.executemany(
        "INSERT INTO orders (id, customer_id, amount, status, ordered_on)"
        " VALUES (?, ?, ?, ?, ?)",
        ORDERS,
    )
    conn.commit()
    return conn
`,
      },
      {
        path: 'report_test.py',
        readOnly: true,
        content: `from database import make_connection
from report import monthly_sales_report

MARCH = ("2026-03-01", "2026-03-31")


def run():
    conn = make_connection()
    try:
        return monthly_sales_report(conn, *MARCH)
    finally:
        conn.close()


def test_totals_only_count_completed_orders_in_the_period():
    rows = dict((name, total) for name, total, _count in run())
    # Ada: 1500 + 5000 + 2500 = 9000. The 9900 order is in April.
    assert rows.get("Ada") == 9000, "Ada should total 9000, got %r" % rows.get("Ada")
    # Grace: 7000 + 800. Cancelled and pending must not count.
    assert rows.get("Grace") == 7800, "Grace should total 7800, got %r" % rows.get("Grace")


def test_order_counts_match_the_totals():
    counts = dict((name, count) for name, _total, count in run())
    assert counts.get("Ada") == 3, "Ada should have 3 completed March orders"
    assert counts.get("Grace") == 2, "Grace should have 2 completed March orders"


def test_every_customer_appears():
    names = sorted(name for name, _total, _count in run())
    assert names == ["Ada", "Grace", "Linus", "Margaret"], (
        "every customer should appear in the report, got %r" % names
    )


def test_a_customer_with_no_orders_reports_zero():
    rows = {name: (total, count) for name, total, count in run()}
    assert rows.get("Linus") == (0, 0), (
        "Linus has no orders and should report (0, 0), got %r" % (rows.get("Linus"),)
    )


def test_a_customer_with_only_cancelled_orders_reports_zero():
    rows = {name: (total, count) for name, total, count in run()}
    assert rows.get("Margaret") == (0, 0), (
        "Margaret's only order was cancelled, so she should report (0, 0), got %r"
        % (rows.get("Margaret"),)
    )


def test_rows_are_ordered_by_spend_then_name():
    ordered = [name for name, _total, _count in run()]
    assert ordered == ["Ada", "Grace", "Linus", "Margaret"], (
        "expected spend descending then name ascending, got %r" % ordered
    )
`,
      },
    ],
  },
  referencePatch: {
    python: {
      'report.py': `def monthly_sales_report(conn, start_date, end_date):
    """Return [(name, total_spent, order_count), ...] for every customer.

    The period and status filters belong in the JOIN condition. Putting them in
    WHERE discards the NULL-extended rows a LEFT JOIN produces for customers with
    no matching orders, which silently makes it an INNER JOIN.
    """
    rows = conn.execute(
        """
        SELECT c.name,
               COALESCE(SUM(o.amount), 0) AS total_spent,
               COUNT(o.id) AS order_count
        FROM customers c
        LEFT JOIN orders o
               ON o.customer_id = c.id
              AND o.status = 'completed'
              AND o.ordered_on BETWEEN ? AND ?
        GROUP BY c.id, c.name
        ORDER BY total_spent DESC, c.name ASC
        """,
        (start_date, end_date),
    ).fetchall()

    return [tuple(row) for row in rows]
`,
    },
  },
  hintLadder: [
    'Run it and print the rows. How many customers come back, and how many are in the table?',
    'Which customers are missing, and what do they have in common?',
    'A LEFT JOIN produces a row with NULLs when there is no match. What does your WHERE clause do to those rows?',
    'A condition on the right-hand table belongs in ON, not WHERE — in WHERE it filters away the NULL-extended rows.',
  ],
  followUps: [
    'How would you have caught this in review? What is the tell?',
    'Would `COUNT(*)` work here instead of `COUNT(o.id)`? Why not?',
    'What index would you add if `orders` had 50 million rows?',
    'The dates are compared as text. When does that bite you?',
  ],
  rubric: WORKSPACE_RUBRIC['bug-squash'],
}
