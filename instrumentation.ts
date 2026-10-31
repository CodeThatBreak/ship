/**
 * Next.js server bootstrap — start long-lived engine background work once per
 * process instead of from GET handlers / loaders.
 */
export const register = async (): Promise<void> => {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const nodeOnly = await import(
    /* webpackIgnore: true */
    "./lib/instrumentation-node"
  );
  await nodeOnly.registerNode();
};
