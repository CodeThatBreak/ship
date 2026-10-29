/**
 * `--require` hook for the prompt-parity check: TS's `@/*` path alias compiles
 * into literal `require("@/x")` calls that Node cannot resolve. This remaps
 * them onto the compiled parity tree (node_modules/.cache/promptparity), where
 * the tsc program has emitted every reachable file — including shared modules
 * under components/ that the engine re-exports (lib/engine/jsonata-eval.ts).
 *
 * Loaded before the parity script:
 *   NODE_OPTIONS="--require=$PWD/scripts/parity-alias-hook.cjs"
 */
/* eslint-disable @typescript-eslint/no-require-imports */
// CJS is mandatory here: a --require hook runs before any module system
// loads, so ESM/import syntax is not available to it.
const Module = require("module");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "node_modules", ".cache", "promptparity");
const origResolve = Module._resolveFilename;

Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith("@/")) {
    request = path.join(ROOT, request.slice(2));
  }
  return origResolve.call(this, request, parent, ...rest);
};
