import "server-only";

import type { RowGateway } from "./rows";

/**
 * Lazy access so `Database` can own the gateway without a module cycle.
 *
 * Pinned on `globalThis` for the same reason as `processSingleton`: under
 * `next dev` each bundle gets its own copy of this module, so module-scope
 * state would leave every graph that did not construct `Database` (the
 * process-wide singleton already exists on `globalThis`, so its constructor
 * never reruns) with a permanently unset gateway.
 */
const ROW_GATEWAY_SLOT = Symbol.for("devflow.rowGateway");

const store = (): Record<PropertyKey, unknown> =>
  globalThis as Record<PropertyKey, unknown>;

export const bindRowGateway = (gateway: RowGateway): void => {
  store()[ROW_GATEWAY_SLOT] = gateway;
};

export const getRowGateway = (): RowGateway => {
  const gateway = store()[ROW_GATEWAY_SLOT] as RowGateway | undefined;
  if (!gateway) {
    throw new Error("RowGateway is not initialized — import @/lib/db before use");
  }
  return gateway;
};
