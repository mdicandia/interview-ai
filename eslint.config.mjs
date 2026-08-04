import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored WASM runtimes copied from node_modules by
    // scripts/copy-runtime-assets.mjs. Minified third-party code we don't own.
    // public/workers/ is ours and stays linted.
    "public/pyodide/**",
    "public/esbuild/**",
    "public/vendor/**",
  ]),
  {
    // The execution workers are plain browser JS with no bundler or DOM types.
    files: ["public/workers/*.js"],
    languageOptions: {
      globals: { self: "readonly", performance: "readonly", console: "readonly" },
    },
  },
  {
    rules: {
      // Allow `const { secret: _secret, ...rest } = obj` to drop a field — the
      // binding is deliberately unused, and the underscore says so.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;
