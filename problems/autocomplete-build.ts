import type { WorkspaceProblem } from '@/lib/problems/types'
import { WORKSPACE_RUBRIC } from '@/lib/problems/types'

/**
 * Live component build — the canonical frontend round, and reportedly the single
 * most common prompt in frontend loops.
 *
 * Unlike the other frontend problem, this is greenfield rather than a bug hunt.
 * The starter is what someone actually writes first: an input, a fetch on every
 * keystroke, a list. Two of eight tests pass from that, which is the point —
 * "it shows results" is the easy 20% and everything that separates a working
 * demo from a shippable component is the other 80%.
 *
 * `search` is injected as a prop rather than imported. That is partly good
 * component design and partly the only way to test the race: the suite needs to
 * control exactly when each response resolves.
 */
export const autocompleteBuild: WorkspaceProblem = {
  kind: 'workspace',
  variant: 'frontend',
  slug: 'autocomplete-build',
  title: 'Build a search autocomplete',
  difficulty: 'medium',
  languages: ['typescript'],
  topics: ['react', 'components', 'async', 'accessibility'],
  goal: 'Build it up until the suite is green. Watch it in the preview as you go.',
  statement: `Build a search-as-you-type autocomplete. There is a naive version in
\`Autocomplete.tsx\` that technically works — it fetches on every keystroke and
renders whatever comes back. Take it the rest of the way.

**What it needs to do**

1. **Debounce** — typing quickly should issue one request, not one per character.
2. **Ignore stale responses** — if the reply for \`"ca"\` arrives *after* the reply
   for \`"cat"\`, the results for \`"cat"\` must win. This is the bug that survives
   most code reviews.
3. **Keyboard navigation** — ArrowDown / ArrowUp move the highlight, Enter selects
   the highlighted item, Escape closes the list.
4. **Empty state** — say so when a search returns nothing, rather than showing
   an empty box.
5. **Accessibility** — the input is a \`combobox\` with \`aria-expanded\`, the list
   is a \`listbox\`, and options are \`option\` with \`aria-selected\`.

**Ground rules**

- \`Autocomplete.tsx\` is the only file to change.
- Keep the \`search(query, signal)\` prop signature — the tests depend on it.
- \`data-testid\` hooks the tests use: \`input\`, \`listbox\`, \`option\`, \`empty\`.
- The preview on the right renders the real component. Use it.`,
  testPath: { typescript: 'Autocomplete.test.tsx' },
  startingState: 'failing',
  files: {
    typescript: [
      {
        path: 'Autocomplete.tsx',
        content: `import { useEffect, useState } from 'react'

export interface AutocompleteProps {
  /** Resolves to matching suggestions. Abort the signal to cancel in flight. */
  search: (query: string, signal: AbortSignal) => Promise<string[]>
  onSelect?: (value: string) => void
  /** How long to wait after typing stops before searching. */
  debounceMs?: number
}

export function Autocomplete({ search, onSelect, debounceMs = 150 }: AutocompleteProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<string[]>([])

  useEffect(() => {
    if (query === '') {
      setResults([])
      return
    }
    const controller = new AbortController()
    search(query, controller.signal).then((found) => {
      setResults(found)
    })
  }, [query, search])

  return (
    <div>
      <input
        data-testid="input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search…"
      />
      {results.length > 0 && (
        <ul data-testid="listbox">
          {results.map((result) => (
            <li key={result} data-testid="option" onClick={() => onSelect?.(result)}>
              {result}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
`,
      },
      {
        path: 'Autocomplete.test.tsx',
        readOnly: true,
        content: `import { act, deepEqual, equal, focus, ok, press, render, settle, typeInto } from 'harness'
import { Autocomplete } from './Autocomplete'

/**
 * A search function whose responses can be released in any order, which is the
 * only way to test the stale-response race deterministically.
 */
function controllableSearch() {
  const calls: string[] = []
  const pending = new Map<string, (results: string[]) => void>()
  let aborted = 0

  const search = (query: string, signal: AbortSignal) => {
    calls.push(query)
    return new Promise<string[]>((resolve, reject) => {
      pending.set(query, resolve)
      signal.addEventListener('abort', () => {
        aborted += 1
        reject(new DOMException('aborted', 'AbortError'))
      })
    })
  }

  return {
    search,
    calls,
    get abortCount() { return aborted },
    /**
     * Release one in-flight request.
     *
     * Wrapped in \`act\` because resolving the promise makes the component set
     * state from a \`.then\`, which React otherwise reports as an update that
     * escaped a test scope. The async form is required: the update lands in a
     * microtask, so a synchronous \`act\` would have already exited.
     */
    async resolve(query: string, results: string[]) {
      await act(async () => {
        pending.get(query)?.(results)
      })
    },
  }
}

/** Types a whole string, one character at a time. */
async function typeText(input: Element, text: string, gapMs = 10) {
  let sofar = ''
  for (const character of text) {
    sofar += character
    typeInto(input as HTMLInputElement, sofar)
    await settle(gapMs)
  }
}

const options = (view: { findAll: (s: string) => Element[] }) =>
  view.findAll('[data-testid="option"]').map((node) => node.textContent)

export function testRendersAnInputAndNoListInitially() {
  const api = controllableSearch()
  const view = render(<Autocomplete search={api.search} />)

  ok(view.find('[data-testid="input"]') !== null, 'expected an input')
  equal(view.find('[data-testid="listbox"]'), null, 'the list should not be shown before searching')
  view.unmount()
}

export async function testShowsResultsForWhatWasTyped() {
  const api = controllableSearch()
  const view = render(<Autocomplete search={api.search} debounceMs={50} />)

  await typeText(view.find('[data-testid="input"]')!, 'cat')
  await settle(120)
  await api.resolve('cat', ['cat', 'catalogue'])
  await settle(30)

  deepEqual(options(view), ['cat', 'catalogue'])
  view.unmount()
}

export async function testDebouncesWhileTypingQuickly() {
  const api = controllableSearch()
  const view = render(<Autocomplete search={api.search} debounceMs={80} />)

  await typeText(view.find('[data-testid="input"]')!, 'cat', 5)
  await settle(200)

  equal(
    api.calls.length,
    1,
    \`typing three characters quickly should issue one request, not \${api.calls.length} (\${api.calls.join(', ')})\`,
  )
  view.unmount()
}

export async function testAStaleResponseDoesNotOverwriteANewerOne() {
  const api = controllableSearch()
  const view = render(<Autocomplete search={api.search} debounceMs={20} />)
  const input = view.find('[data-testid="input"]')!

  // Two searches in flight: an older "ca" and a newer "cat".
  typeInto(input as HTMLInputElement, 'ca')
  await settle(40)
  typeInto(input as HTMLInputElement, 'cat')
  await settle(40)

  // The newer one lands first, then the older straggler arrives.
  await api.resolve('cat', ['cat', 'catalogue'])
  await settle(20)
  await api.resolve('ca', ['car', 'cardigan', 'cannot'])
  await settle(40)

  deepEqual(
    options(view),
    ['cat', 'catalogue'],
    'the late reply for "ca" overwrote the results for "cat"',
  )
  view.unmount()
}

export async function testArrowKeysAndEnterSelectAnOption() {
  const api = controllableSearch()
  let selected: string | null = null
  const view = render(
    <Autocomplete search={api.search} debounceMs={20} onSelect={(v) => { selected = v }} />,
  )
  const input = view.find('[data-testid="input"]')!

  typeInto(input as HTMLInputElement, 'ca')
  await settle(40)
  await api.resolve('ca', ['car', 'cardigan', 'cannot'])
  await settle(30)

  focus(input)
  press(input, 'ArrowDown')
  press(input, 'ArrowDown')
  press(input, 'Enter')
  await settle(20)

  equal(selected, 'cardigan', 'two ArrowDowns then Enter should select the second option')
  view.unmount()
}

export async function testEscapeClosesTheList() {
  const api = controllableSearch()
  const view = render(<Autocomplete search={api.search} debounceMs={20} />)
  const input = view.find('[data-testid="input"]')!

  typeInto(input as HTMLInputElement, 'ca')
  await settle(40)
  await api.resolve('ca', ['car', 'cardigan'])
  await settle(30)
  ok(view.find('[data-testid="listbox"]') !== null, 'the list should be open first')

  focus(input)
  press(input, 'Escape')
  await settle(20)

  equal(view.find('[data-testid="listbox"]'), null, 'Escape should close the list')
  view.unmount()
}

export async function testShowsAnEmptyStateWhenNothingMatches() {
  const api = controllableSearch()
  const view = render(<Autocomplete search={api.search} debounceMs={20} />)

  typeInto(view.find('[data-testid="input"]') as HTMLInputElement, 'zzz')
  await settle(40)
  await api.resolve('zzz', [])
  await settle(30)

  ok(
    view.find('[data-testid="empty"]') !== null,
    'expected an element with data-testid="empty" when a search returns nothing',
  )
  view.unmount()
}

export async function testIsAnAccessibleCombobox() {
  const api = controllableSearch()
  const view = render(<Autocomplete search={api.search} debounceMs={20} />)
  const input = view.find('[data-testid="input"]')!

  equal(input.getAttribute('role'), 'combobox', 'the input should have role="combobox"')
  equal(input.getAttribute('aria-expanded'), 'false', 'aria-expanded should be false when closed')

  typeInto(input as HTMLInputElement, 'ca')
  await settle(40)
  await api.resolve('ca', ['car', 'cardigan'])
  await settle(30)

  equal(input.getAttribute('aria-expanded'), 'true', 'aria-expanded should be true when open')
  equal(
    view.find('[data-testid="listbox"]')?.getAttribute('role'),
    'listbox',
    'the list should have role="listbox"',
  )
  equal(
    view.find('[data-testid="option"]')?.getAttribute('role'),
    'option',
    'each item should have role="option"',
  )
  view.unmount()
}
`,
      },
    ],
  },
  referencePatch: {
    typescript: {
      'Autocomplete.tsx': `import { useEffect, useRef, useState } from 'react'

export interface AutocompleteProps {
  search: (query: string, signal: AbortSignal) => Promise<string[]>
  onSelect?: (value: string) => void
  debounceMs?: number
}

export function Autocomplete({ search, onSelect, debounceMs = 150 }: AutocompleteProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [searched, setSearched] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const listId = useRef('autocomplete-list').current

  useEffect(() => {
    if (query === '') {
      setResults([])
      setOpen(false)
      setSearched(false)
      return
    }

    const controller = new AbortController()
    // The cleanup flag is what fixes the race. Aborting alone is not enough:
    // a promise that already resolved will still run its .then, so the effect
    // has to refuse to apply results it knows are stale.
    let stale = false

    const timer = setTimeout(() => {
      search(query, controller.signal)
        .then((found) => {
          if (stale) return
          setResults(found)
          setSearched(true)
          setOpen(true)
          setHighlighted(-1)
        })
        .catch(() => {
          // An abort is the expected outcome of typing again; nothing to do.
        })
    }, debounceMs)

    return () => {
      stale = true
      controller.abort()
      clearTimeout(timer)
    }
  }, [query, search, debounceMs])

  const choose = (value: string) => {
    onSelect?.(value)
    setOpen(false)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlighted((current) => Math.min(current + 1, results.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted((current) => Math.max(current - 1, 0))
    } else if (event.key === 'Enter') {
      if (highlighted >= 0 && results[highlighted]) choose(results[highlighted])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  const showList = open && results.length > 0

  return (
    <div>
      <input
        data-testid="input"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Search…"
      />

      {showList && (
        <ul id={listId} data-testid="listbox" role="listbox">
          {results.map((result, index) => (
            <li
              key={result}
              data-testid="option"
              role="option"
              aria-selected={index === highlighted}
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => choose(result)}
              style={index === highlighted ? { background: '#e8f0fe' } : undefined}
            >
              {result}
            </li>
          ))}
        </ul>
      )}

      {open && searched && results.length === 0 && (
        <div data-testid="empty">No matches</div>
      )}
    </div>
  )
}
`,
    },
  },
  hintLadder: [
    'Which of the failing tests is about something you can see in the preview?',
    'Type quickly and count the requests. What fires the search, and how often?',
    'Two searches are in flight and the older one comes back last. Which result wins, and why?',
    "Aborting isn't enough on its own — a promise that already resolved still runs its `.then`. The effect cleanup needs to mark the old request as stale and refuse to apply it.",
  ],
  followUps: [
    'What is the difference between debouncing and throttling here, and why did you pick one?',
    'Where would you announce results to a screen reader, and how?',
    'How would you cache results so backspacing feels instant?',
    'The list can be a thousand items. What changes?',
  ],
  rubric: WORKSPACE_RUBRIC.frontend,
}
