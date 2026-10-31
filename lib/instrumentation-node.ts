import "server-only";

/**
 * Node-only instrumentation body — kept out of the static import graph so
 * Next.js middleware (Edge) compilation does not pull better-sqlite3 / SDK.
 */
export const registerNode = async (): Promise<void> => {
  const { config } = await import("./config");
  config.gitlab.logStartupWarnings();
  const { ensureLocalApiToken } = await import("./local-api/token");
  ensureLocalApiToken();
  const { flowPoller } = await import("./engine/runtime/flow-poller");
  flowPoller.start();
};
