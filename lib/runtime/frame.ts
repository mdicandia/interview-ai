/**
 * The iframe execution path, used for frontend problems.
 *
 * Web Workers have no DOM — no `document`, no `window`, no `HTMLElement` — so
 * component code cannot run where the other problems run. The alternative to this
 * would be a headless DOM shim inside the worker, which does work, but you would
 * never *see* the component. For a frontend interview that's most of the job, so
 * the component renders in a real, visible iframe and the tests drive it there.
 *
 * Division of labour:
 *   - the JS worker bundles the files (it already owns the esbuild instance)
 *   - this module hosts the bundle in a sandboxed iframe and relays results
 *
 * The iframe is `sandbox="allow-scripts"` and therefore runs on an opaque origin:
 * candidate code cannot touch the parent document, cookies, or storage. The only
 * channel back is `postMessage`, which is exactly the channel we want.
 */

import type { TestResult } from './protocol'

/** Injected after the bundle. Discovers exported tests and reports each result. */
const RUNNER_EPILOGUE = `
(async () => {
  const send = (message) => parent.postMessage({ __frame: true, ...message }, '*');

  const suite = window.__suite || {};
  const names = Object.keys(suite)
    .filter((k) => k.startsWith('test') && typeof suite[k] === 'function')
    .sort();

  if (names.length === 0) {
    send({ type: 'compile-error', message: 'No tests found.\\n\\nTests must be exported functions whose names start with \`test\`.' });
    return;
  }

  send({ type: 'suite-start', tests: names });

  for (const name of names) {
    const started = performance.now();
    let ok = true;
    let error;
    try {
      await suite[name]();
    } catch (e) {
      ok = false;
      error = e && e.stack ? String(e.stack).split('\\n').slice(0, 6).join('\\n') : String(e);
    }
    send({ type: 'test-outcome', name, ok, error, durationMs: performance.now() - started });
  }

  // Leave a live component on screen. Tests unmount as they should, which would
  // otherwise blank the preview at exactly the moment it becomes useful.
  try { if (window.__replayLastRender) window.__replayLastRender(); } catch (e) {}

  send({ type: 'run-complete' });
})();
`

function frameDocument(bundle: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      /*
       * Deliberately plain. The component under test should look like itself, not
       * like this app — a candidate debugging a layout needs to trust what they see.
       */
      html, body { margin: 0; height: 100%; background: #ffffff; color: #111318; }
      body { font: 14px/1.5 system-ui, -apple-system, sans-serif; }
      #root { padding: 16px; }
      #error {
        display: none; margin: 0; padding: 12px 16px; white-space: pre-wrap;
        font: 12px/1.5 ui-monospace, Menlo, monospace; color: #b3261e; background: #fdecea;
      }
    </style>
  </head>
  <body>
    <pre id="error"></pre>
    <div id="root"></div>
    <script>
      // React's act() refuses to run without this, and every DOM helper uses act.
      window.IS_REACT_ACT_ENVIRONMENT = true;

      // A render that throws would otherwise leave a blank frame with no clue why.
      window.addEventListener('error', (event) => {
        var box = document.getElementById('error');
        box.style.display = 'block';
        box.textContent = String(event.message);
      });
      window.addEventListener('unhandledrejection', (event) => {
        var box = document.getElementById('error');
        box.style.display = 'block';
        box.textContent = String(event.reason && event.reason.message || event.reason);
      });
    </script>
    <script>${bundle}</script>
    <script>${RUNNER_EPILOGUE}</script>
  </body>
</html>`
}

interface FrameMessage {
  __frame: true
  type: 'suite-start' | 'test-outcome' | 'run-complete' | 'compile-error'
  tests?: string[]
  name?: string
  ok?: boolean
  error?: string
  message?: string
  durationMs?: number
}

export interface FrameRunResult {
  results: TestResult[]
  discovered: string[]
  compileError?: string
}

/**
 * Loads a bundle into the given iframe and runs its tests.
 *
 * The iframe element is owned by the caller (the preview pane) rather than
 * created here, because it has to stay on screen: the point is to watch the
 * component while the tests drive it.
 */
export function runInFrame(
  frame: HTMLIFrameElement,
  bundle: string,
  options: { timeoutMs: number; onResult?: (result: TestResult) => void },
): Promise<FrameRunResult> {
  const { timeoutMs, onResult } = options

  return new Promise<FrameRunResult>((resolve) => {
    const results: TestResult[] = []
    let discovered: string[] = []
    let watchdog: ReturnType<typeof setTimeout>

    const finish = (compileError?: string) => {
      clearTimeout(watchdog)
      window.removeEventListener('message', onMessage)
      resolve({ results, discovered, compileError })
    }

    // A component stuck in an infinite render loop never yields, so the frame
    // stops reporting. Blanking `srcdoc` tears down that execution context —
    // the iframe equivalent of terminating a wedged worker.
    const onTimeout = () => {
      const stalled = discovered[results.length]
      if (stalled) {
        results.push({
          name: stalled,
          status: 'timeout',
          hidden: false,
          error: `Timed out after ${timeoutMs}ms — an infinite render loop or a promise that never settles.`,
          durationMs: timeoutMs,
        })
      }
      for (const name of discovered.slice(results.length)) {
        results.push({
          name,
          status: 'skipped',
          hidden: false,
          error: 'Skipped — an earlier test timed out.',
          durationMs: 0,
        })
      }
      frame.srcdoc = '<!doctype html><html><body></body></html>'
      finish()
    }

    const arm = () => {
      clearTimeout(watchdog)
      watchdog = setTimeout(onTimeout, timeoutMs)
    }

    const onMessage = (event: MessageEvent) => {
      // The frame is sandboxed onto an opaque origin, so `event.origin` is "null"
      // and useless for filtering. Identify it by source instead, which cannot be
      // spoofed by another frame.
      if (event.source !== frame.contentWindow) return
      const message = event.data as FrameMessage
      if (!message?.__frame) return

      switch (message.type) {
        case 'suite-start':
          discovered = message.tests ?? []
          arm()
          break
        case 'test-outcome': {
          const result: TestResult = {
            name: message.name ?? '(unnamed)',
            status: message.ok ? 'pass' : 'fail',
            hidden: false,
            error: message.error,
            durationMs: message.durationMs ?? 0,
          }
          results.push(result)
          onResult?.(result)
          arm()
          break
        }
        case 'compile-error':
          finish(message.message)
          break
        case 'run-complete':
          finish()
          break
      }
    }

    window.addEventListener('message', onMessage)
    arm()
    frame.srcdoc = frameDocument(bundle)
  })
}
