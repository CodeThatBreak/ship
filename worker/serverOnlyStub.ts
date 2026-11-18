/**
 * `server-only` stub for the worker process (engine overhaul step 03,
 * decision Q10). The marker exists to keep `lib/` out of CLIENT bundles —
 * the worker never shares a bundle with client code and imports the same
 * `lib/` modules directly, so it maps the package to this empty module via
 * `worker/tsconfig.json` paths. Never import this file directly.
 */
export {};
