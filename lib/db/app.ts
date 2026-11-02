import "server-only";

import { processSingleton } from "../singleton";
import { Database } from "./database";

export type { Repo } from "./rows";
export {
  Database,
  DatabaseMigrationError,
  SCHEMA_USER_VERSION,
  SchemaMigrator,
  TemplateSeeder,
} from "./database";
export { RowGateway } from "./rows";
export { getDb } from "./dbAccess";
export { getRowGateway } from "./rowGatewayAccess";

const ensureBackgroundWorkers = (): void => {
  processSingleton("background-workers", () => {
    void import("../engine/runtime/flowPoller").then(({ flowPoller }) => {
      flowPoller.start();
    });
    return true;
  });
};

const shouldStartBackgroundWorkers = (): boolean =>
  process.env.NODE_ENV !== "test" && process.env.VITEST !== "true";

/** Shared application database. */
export const db = processSingleton("db", () => {
  if (shouldStartBackgroundWorkers()) {
    ensureBackgroundWorkers();
  }
  return new Database();
});
