import "server-only";

import { GraphService } from "./graphService/graphService";

/** Shared graph API service (stateless, db-fenced — decision Q9, plain module
 *  const). The GraphService class lives in `graphService/graphService.ts` —
 *  class files are pure (classFilePurity arch test); this module keeps the
 *  pin so the import surface is unchanged. */
export const graphService = new GraphService();
