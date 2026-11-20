import "server-only";

import type { z } from "zod";
import type { NodeDefinition } from "../../shared/nodeDefinition";
import type { DeclarativeRow } from "./declarativeRow";

/** One registered declarative kind: its config schema + def factory. */
export interface DeclarativeKindEntry {
  schema: z.ZodTypeAny;
  instantiate: (
    row: DeclarativeRow,
    inst?: string,
  ) => NodeDefinition<unknown, Record<string, unknown>>;
}
