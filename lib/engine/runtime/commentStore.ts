import "server-only";

import { CommentStore } from "./commentStore/commentStore";

/**
 * Shared comment store pin (stateless, db-fenced — decision Q9). The
 * CommentStore class lives in `commentStore/`; this module keeps the pin so
 * the import surface (`commentStore`) is unchanged. Class files are pure
 * (classFilePurity arch test), so the instance is pinned here.
 */
export const commentStore = new CommentStore();
