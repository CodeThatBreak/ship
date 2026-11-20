import "server-only";

import { db } from "../db/app";
import { SecretStore } from "./secretStore/secretStore";

/**
 * Shared secret store pin (stateless, db-fenced — decision Q9). The
 * SecretStore class lives in `secretStore/`; this module keeps the pin so
 * the import surface (`secretStore`) is unchanged. Class files are pure
 * (classFilePurity arch test), so the instance is pinned here.
 */
export const secretStore = new SecretStore(db, db.integrationSecrets);
