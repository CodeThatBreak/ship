import "server-only";

import type { RowGateway } from "./rows";

/**
 * Lazy access so `Database` can own the gateway without a module cycle.
 *
 * The slot exists for the same lazy-resolution reason as `dbAccess.ts`: the
 * gateway is bound by the `Database` constructor, and graphs that use the
 * `rows` proxy without importing `lib/db/app` reach it through
 * {@link getRowGateway}. The `Database` itself is a plain module const in
 * `lib/db/app.ts` (decision Q9 — no process pinning needed), so every graph
 * that constructs it re-binds its own identical copy.
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
