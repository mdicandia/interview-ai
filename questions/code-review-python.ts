import type { DiscussionProblem } from '@/lib/problems/types'
import { DISCUSSION_RUBRIC } from '@/lib/problems/types'

/**
 * Code review with planted issues, deliberately spanning severities — a security
 * hole, a correctness bug, a resource leak, and one thing that is merely ugly.
 *
 * The mixed severity is the point. Anyone can list everything they'd change; the
 * signal is whether SQL injection gets flagged before variable naming, and
 * whether the candidate says out loud that some of it is taste rather than a bug.
 */
export const codeReviewPython: DiscussionProblem = {
  kind: 'discussion',
  format: 'code-review',
  slug: 'code-review-user-export',
  title: 'Review: user export endpoint',
  difficulty: 'medium',
  languages: ['python'],
  expectedMinutes: 12,
  topics: ['code review', 'security', 'error handling'],
  statement: `A colleague has opened a pull request adding a CSV export endpoint. It
works — they've tested it manually and the file downloads fine.

Read \`export_handler.py\` and review it as you would a real PR.`,
  prompt:
    "Walk me through this pull request. What would you comment on, and what would " +
    'block the merge versus what is a nice-to-have?',
  context: [
    {
      path: 'export_handler.py',
      readOnly: true,
      content: `import csv
import io


def export_users(request, db):
    """GET /admin/export?org_id=...&sort=name — returns a CSV of users."""
    org_id = request.args.get("org_id")
    sort = request.args.get("sort", "name")

    cursor = db.execute(
        "SELECT id, email, full_name, last_login, is_admin "
        "FROM users WHERE org_id = " + org_id + " ORDER BY " + sort
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "email", "full_name", "last_login", "is_admin"])

    rows = cursor.fetchall()
    for r in rows:
        try:
            writer.writerow(r)
        except Exception:
            pass

    f = open("/tmp/last_export.csv", "w")
    f.write(output.getvalue())

    return {
        "status": 200,
        "body": output.getvalue(),
        "headers": {"Content-Type": "text/csv"},
    }
`,
    },
  ],
  expectedPoints: [
    {
      point:
        'SQL injection: `org_id` and `sort` are concatenated straight into the query. ' +
        '`org_id` should be a bound parameter; `sort` cannot be bound, so it must be ' +
        'validated against an allow-list of column names.',
      essential: true,
      weakAnswer:
        'Says "use parameterised queries" and stops — which does not fix `sort`, ' +
        'since a bind parameter cannot be an ORDER BY column.',
    },
    {
      point:
        'No authorisation check. The path says /admin and the payload includes email ' +
        'addresses and `is_admin`, but nothing verifies the caller may read this org.',
      essential: true,
    },
    {
      point:
        'The bare `except: pass` swallows every row-level failure silently, so a ' +
        'partial export looks identical to a complete one.',
      essential: true,
      weakAnswer: 'Notices the bare except but frames it as style rather than silent data loss.',
    },
    {
      point:
        'The file handle is never closed, and is not in a `with` block — on an ' +
        'exception it leaks.',
      essential: true,
    },
    {
      point:
        'Writing to a fixed path `/tmp/last_export.csv` is a race between concurrent ' +
        'requests, and it is unclear why the endpoint writes to disk at all.',
    },
    {
      point:
        '`fetchall()` loads the entire result set into memory, then builds the whole ' +
        'CSV in memory again. This should stream for a large org.',
    },
    {
      point:
        'No pagination or row limit, so response size is unbounded and controlled by ' +
        'the data rather than the API.',
    },
    {
      point:
        'Missing `Content-Disposition`, so browsers render the CSV instead of ' +
        'downloading it. Minor, and worth saying so.',
    },
    {
      point:
        '`org_id` is never checked for presence — a missing parameter produces `None` ' +
        'and a confusing error rather than a 400.',
    },
  ],
  hintLadder: [
    'Anything jump out on the security side?',
    'Look at how the query string is built. What can the caller control?',
    'If I pass `sort=(SELECT ...)`, what happens?',
    'Now look at the loop and the file handle — what happens when something goes wrong mid-export?',
  ],
  followUps: [
    'You listed several issues. Which one would you fix first, and why that one?',
    'How would you make the ORDER BY safe without hard-coding every option?',
    'Which of these would a linter or type checker have caught on its own?',
    'How would you phrase the SQL injection comment to the author without it landing badly?',
  ],
  rubric: DISCUSSION_RUBRIC['code-review'],
}
