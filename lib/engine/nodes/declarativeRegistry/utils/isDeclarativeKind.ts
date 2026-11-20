import "server-only";

import { DECLARATIVE_KINDS, type DeclarativeKind } from "../constants/declarativeKinds";

/** Whether a `node_templates` row kind is one of the declarative kinds. */
export const isDeclarativeKind = (kind: string): kind is DeclarativeKind =>
  (DECLARATIVE_KINDS as readonly string[]).includes(kind);
