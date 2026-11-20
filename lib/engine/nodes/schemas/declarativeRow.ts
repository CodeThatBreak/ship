import "server-only";

import { z } from "zod";

/**
 * The `node_templates` row a declarative def hydrates from — the boundary
 * parse `declarative.ts` applies before the kind registry instantiates the
 * def (the kind config itself is validated by the kind's def schema in
 * `schemas/declarativeSchemas.ts`).
 */
export const DeclarativeRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  kind: z.string(),
  config: z.unknown(),
});
