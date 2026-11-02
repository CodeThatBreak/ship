/**
 * Next.js server bootstrap — start long-lived engine background work once per
 * process instead of from GET handlers / loaders.
 */
export const register = async (): Promise<void> => {
  if (process.env.NEXT_RUNTIME === "edge") return;
  // The Node-only bootstrap stays out of the compiled bundle: the Edge build
  // of this hook must not pull better-sqlite3 / SDK into the middleware
  // graph. `webpackIgnore` leaves a real runtime import, so resolve the file
  // from the app root (Next runs with the project root as cwd) rather than a
  // path relative to the `.next/server` output directory. No `node:` imports
  // here — the Edge compile of this file cannot resolve the `node:` scheme.
  const bootstrapUrl = `file://${process.cwd()}/instrumentation.node.mjs`;
  const nodeOnly = (await import(
    /* webpackIgnore: true */ bootstrapUrl
  )) as { registerNode: () => Promise<void> };
  await nodeOnly.registerNode();
};
