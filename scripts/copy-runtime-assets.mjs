// Copies the WASM runtimes the browser workers fetch at runtime into /public.
//
// Both Pyodide and esbuild-wasm load their .wasm payload by URL rather than
// through the bundler, so the files have to exist at a stable public path.
// Serving them locally also keeps the app working offline and avoids a CDN
// round-trip on every cold start.
//
// Runs automatically via `postinstall`.

import { cp, mkdir, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/** @type {{ pkg: string, dest: string, files: string[] }[]} */
const ASSETS = [
  {
    pkg: 'pyodide',
    dest: 'pyodide',
    // Everything Pyodide needs to boot and import the stdlib. Deliberately skips
    // the bundled console.html demos and sourcemaps (~10MB of dead weight).
    files: [
      'pyodide.mjs',
      'pyodide.asm.mjs',
      'pyodide.asm.wasm',
      'pyodide-lock.json',
      'python_stdlib.zip',
    ],
  },
  {
    pkg: 'esbuild-wasm',
    dest: 'esbuild',
    // Used only to strip TypeScript types before execution.
    files: ['esbuild.wasm'],
    // The ESM browser build, imported directly by public/workers/js.worker.js.
    nested: [{ from: 'esm/browser.min.js', to: 'browser.min.js' }],
  },
]

const exists = async (p) => {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

let copied = 0

for (const asset of ASSETS) {
  const src = join(root, 'node_modules', asset.pkg)
  const dest = join(root, 'public', asset.dest)

  if (!(await exists(src))) {
    console.error(
      `[runtime-assets] node_modules/${asset.pkg} not found — run \`pnpm install\` first.`,
    )
    process.exit(1)
  }

  const available = new Set(await readdir(src))
  const missing = asset.files.filter((f) => !available.has(f))
  if (missing.length > 0) {
    console.error(
      `[runtime-assets] ${asset.pkg} is missing expected files: ${missing.join(', ')}.\n` +
        '  The package layout may have changed — update ASSETS in scripts/copy-runtime-assets.mjs.',
    )
    process.exit(1)
  }

  await mkdir(dest, { recursive: true })
  for (const file of asset.files) {
    await cp(join(src, file), join(dest, file))
    copied++
  }

  // Files that live in a subdirectory of the package and get flattened into dest.
  for (const { from, to } of asset.nested ?? []) {
    const source = join(src, from)
    if (!(await exists(source))) {
      console.error(
        `[runtime-assets] ${asset.pkg} is missing ${from}.\n` +
          '  The package layout may have changed — update ASSETS in scripts/copy-runtime-assets.mjs.',
      )
      process.exit(1)
    }
    await cp(source, join(dest, to))
    copied++
  }
}

/*
 * React, pre-bundled into one ESM file for the frontend sandbox.
 *
 * Frontend problems run in an iframe and import 'react' / 'react-dom/client' /
 * 'react/jsx-runtime'. The in-browser bundler has no node_modules to resolve
 * those against, and a strict offline story rules out a CDN — so we flatten all
 * three entry points into a single module here, at install time, and let the
 * browser bundler alias every one of them to it.
 *
 * Uses native esbuild (a devDependency) rather than esbuild-wasm: this runs in
 * Node against the real filesystem, which is exactly what the wasm build can't do.
 */
/*
 * Named exports are destructured at runtime rather than re-exported with
 * `export * from 'react'`. React ships CommonJS, and after esbuild's interop a
 * star re-export exposes nothing statically analysable — `import { useState }`
 * then fails with "No matching export". Destructuring the namespace object sees
 * the same properties the CJS module actually defines.
 */
const REACT_FACADE = `
import * as React from 'react'
import * as ReactDOMClient from 'react-dom/client'
import * as JSXRuntime from 'react/jsx-runtime'

export default React

export const {
  useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback,
  useReducer, useContext, useId, useTransition, useDeferredValue,
  useSyncExternalStore, useImperativeHandle, useDebugValue,
  createContext, createElement, cloneElement, isValidElement, Children,
  memo, forwardRef, Fragment, StrictMode, Suspense, lazy, startTransition, act,
} = React

export const { createRoot, hydrateRoot } = ReactDOMClient
export const { jsx, jsxs } = JSXRuntime
`

const vendorDir = join(root, 'public', 'vendor')
await mkdir(vendorDir, { recursive: true })

await esbuild.build({
  stdin: { contents: REACT_FACADE, resolveDir: root, loader: 'js' },
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: join(vendorDir, 'react.js'),
  // Development build: the frontend problems are debugging exercises, and React's
  // dev-mode warnings ("Cannot update a component while rendering a different
  // one", key warnings, act() warnings) are a large part of the actual signal.
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'warning',
})

const reactBytes = (await stat(join(vendorDir, 'react.js'))).size
console.log(
  `[runtime-assets] copied ${copied} files into public/, ` +
    `bundled react into public/vendor/react.js (${Math.round(reactBytes / 1024)}KB)`,
)
