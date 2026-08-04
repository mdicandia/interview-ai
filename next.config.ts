import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Pyodide is loaded at runtime from /public/pyodide (see lib/runtime/pyodide.worker.ts),
  // not bundled, so it needs no build configuration here.
}

export default nextConfig
