import "server-only";

import type { RowGateway } from "./rows";

/** Lazy access so `Database` can own the gateway without a module cycle. */
let rowGateway: RowGateway | undefined;

export const bindRowGateway = (gateway: RowGateway): void => {
  rowGateway = gateway;
};

export const getRowGateway = (): RowGateway => {
  if (!rowGateway) {
    throw new Error("RowGateway is not initialized — import @/lib/db before use");
  }
  return rowGateway;
};
