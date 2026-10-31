/**
 * Next.js server bootstrap — start long-lived engine background work once per
 * process instead of from GET handlers / loaders.
 */
export const register = async (): Promise<void> => {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { ensureLocalApiToken } = await import("./lib/local-api/token");
  ensureLocalApiToken();
  const { flowPoller } = await import("./lib/engine/runtime/flow-poller");
  flowPoller.start();
};
