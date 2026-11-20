import "server-only";

import type { z } from "zod";
import type { NodeDefinition } from "../shared/nodeDefinition";
import type { DeclarativeKind } from "./constants/declarativeKinds";
import { parseDeclarativeConfig } from "../declarativeConfigParser";
import type { DeclarativeRow } from "./types/declarativeRow";
import type { DeclarativeKindEntry } from "./types/declarativeKindEntry";
import { isDeclarativeKind } from "./utils/isDeclarativeKind";

/**
 * Registry of the declarative node kinds: each kind registers the Zod schema
 * that validates its `node_templates` config and the factory that instantiates
 * a runtime def from a row (wired statically by `declarativeWiring.ts`).
 */
export class DeclarativeKindRegistry {
  private readonly byKind = new Map<DeclarativeKind, DeclarativeKindEntry>();

  register(
    kind: DeclarativeKind,
    schema: z.ZodTypeAny,
    instantiate: DeclarativeKindEntry["instantiate"],
  ): void {
    this.byKind.set(kind, { schema, instantiate });
  }

  parseConfig(kind: string, config: unknown, name = "node"): Record<string, unknown> {
    return parseDeclarativeConfig(kind, config, name);
  }

  instantiate(
    row: DeclarativeRow,
    inst?: string,
  ): NodeDefinition<unknown, Record<string, unknown>> | undefined {
    if (!isDeclarativeKind(row.kind)) return undefined;
    return this.byKind.get(row.kind)?.instantiate(row, inst);
  }
}
