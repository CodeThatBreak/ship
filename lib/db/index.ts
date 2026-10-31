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
export { getDb } from "./db-access";
export { getRowGateway } from "./row-gateway-access";

/** Shared application database. */
export const db = processSingleton("db", () => new Database());
