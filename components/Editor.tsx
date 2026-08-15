'use client'

import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { linter, lintGutter, type Diagnostic as CmDiagnostic } from '@codemirror/lint'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import { basicSetup } from 'codemirror'
import { indentWithTab } from '@codemirror/commands'
import { useEffect, useRef } from 'react'
import type { Language } from '@/lib/problems/types'

interface EditorProps {
  value: string
  language: Language
  onChange: (value: string) => void
  /**
   * Test files are read-only. Letting a candidate "fix" a bug squash by editing
   * the assertions defeats the exercise, and in a real repo the test *is* the spec.
   */
  readOnly?: boolean
  /** Cmd/Ctrl+Enter runs the tests, matching the muscle memory of most REPLs. */
  onRun?: () => void
  /**
   * Cmd/Ctrl+S. Drafts are saved continuously anyway, so this only confirms it —
   * but the keystroke is pure reflex under pressure, and without a binding the
   * browser answers it with a "save this page" dialog over your editor.
   */
  onSave?: () => void
  /**
   * Syntax errors for the gutter, from whichever runtime will execute this code.
   *
   * Optional, and absent on read-only panes: a test file you cannot edit cannot
   * acquire a syntax error, and marking one up would suggest the exercise is
   * broken. Returning an empty list is how "nothing to report" and "could not
   * check right now" are both expressed — the editor cannot tell them apart and
   * should not try.
   */
  onLint?: (code: string) => Promise<{ line: number; column: number; message: string }[]>
}

/**
 * `jsx: true` is not optional here.
 *
 * Frontend problems are `.tsx` files, and without it the parser treats `<div>`
 * as a comparison operator — so highlighting collapses into nonsense partway
 * down any component and never recovers.
 */
const languageExtension = (language: Language) =>
  language === 'python' ? python() : javascript({ typescript: true, jsx: true })

/**
 * CodeMirror lives outside React's render cycle: the view owns the DOM and its own
 * state, so it is created once and then reconfigured imperatively. Recreating it on
 * every render would drop the cursor, selection, and undo history on each keystroke.
 */
export function Editor({
  value,
  language,
  onChange,
  readOnly = false,
  onRun,
  onSave,
  onLint,
}: EditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const languageCompartment = useRef(new Compartment())

  // Kept in refs so the CodeMirror extensions can call the *latest* callbacks
  // without the view being torn down and rebuilt whenever a prop identity changes.
  // Assigned in an effect, not during render — a render can be discarded, and
  // mutating a ref on a discarded render leaves it pointing at a stale closure.
  const onChangeRef = useRef(onChange)
  const onRunRef = useRef(onRun)
  const onSaveRef = useRef(onSave)
  const onLintRef = useRef(onLint)
  useEffect(() => {
    onChangeRef.current = onChange
    onRunRef.current = onRun
    onSaveRef.current = onSave
    onLintRef.current = onLint
  })

  useEffect(() => {
    if (!host.current) return

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        oneDark,
        languageCompartment.current.of(languageExtension(language)),
        // Read-only rather than disabled: the text stays selectable and
        // scrollable, which matters because these files are meant to be *read*.
        EditorState.readOnly.of(readOnly),
        keymap.of([
          indentWithTab,
          {
            key: 'Mod-Enter',
            preventDefault: true,
            run: () => {
              onRunRef.current?.()
              return true
            },
          },
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              onSaveRef.current?.()
              return true
            },
          },
        ]),
        /*
         * Long delay, on purpose.
         *
         * Half-typed code is syntactically invalid almost continuously, so a
         * linter that keeps up with the keystrokes spends its life underlining
         * the line you are in the middle of writing. Waiting until you stop
         * means the marks appear when you might actually want them.
         */
        linter(
          async (view): Promise<CmDiagnostic[]> => {
            const check = onLintRef.current
            if (!check) return []
            const doc = view.state.doc
            const found = await check(doc.toString())
            return found.map((problem) => {
              // A compiler counts lines from one and the document counts from
              // zero, and a stale diagnostic can name a line the document no
              // longer has — clamped rather than dropped, because the error is
              // still real even when its position has drifted.
              const lineNumber = Math.min(Math.max(problem.line, 1), doc.lines)
              const line = doc.line(lineNumber)
              const from = Math.min(line.from + Math.max(problem.column, 0), line.to)
              return {
                from,
                to: line.to,
                severity: 'error' as const,
                message: problem.message,
              }
            })
          },
          { delay: 900 },
        ),
        // `basicSetup` wires the lint keymap but not the gutter, so without this
        // the only sign of an error is a squiggle you have to already be looking
        // at. The margin dot is visible from anywhere in the file.
        lintGutter(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString())
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13.5px' },
          '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65' },
          '&.cm-focused': { outline: 'none' },
          '.cm-gutters': { border: 'none' },
        }),
      ],
    })

    const instance = new EditorView({ state, parent: host.current })
    view.current = instance
    return () => {
      instance.destroy()
      view.current = null
    }
    // Intentionally mount-only. `value` and `language` are synced by the effects
    // below; including them here would rebuild the editor and lose editing state.
    // `readOnly` is fixed per file, and the parent keys this component by file
    // path, so switching tabs remounts and picks up the new value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Swap the language mode in place via a compartment — no view rebuild.
  useEffect(() => {
    view.current?.dispatch({
      effects: languageCompartment.current.reconfigure(languageExtension(language)),
    })
  }, [language])

  // Only push external changes in (loading starter code, switching language).
  // Echoing back what the user just typed would fight the cursor.
  useEffect(() => {
    const instance = view.current
    if (!instance) return
    const current = instance.state.doc.toString()
    if (current === value) return
    instance.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    })
  }, [value])

  return <div ref={host} className="h-full overflow-hidden" />
}
