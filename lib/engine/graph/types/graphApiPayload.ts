import "server-only";

import { nodeRegistry } from "@/lib/engine/nodes/registry";

/** The `/api/graph` response payload (node order, metadata, edges). */
export type GraphApiPayload = {
  templateId?: string;
  order: string[];
  meta: Record<string, unknown>;
  edges: readonly (readonly [string, string, string])[] | ReturnType<typeof nodeRegistry.edges>;
  edgeSpecs?: {
    from: string;
    to: string;
    kind: string;
    label: string | null;
    condition: string | null;
  }[];
};
