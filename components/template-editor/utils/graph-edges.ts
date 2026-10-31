import { edgeDedupeKey } from "@/constants/template-graph";
import type { EditorEdge } from "../types";

export const isDuplicateTemplateEdge = (
  edges: EditorEdge[],
  from: string,
  to: string,
  label: string | null | undefined,
  skipIndex?: number,
): boolean =>
  edges.some(
    (e, i) =>
      i !== skipIndex &&
      edgeDedupeKey(e.from, e.to, e.label) === edgeDedupeKey(from, to, label),
  );

export const canConnectTemplateEdge = (
  edges: EditorEdge[],
  from: string,
  to: string,
  label?: string | null,
): boolean =>
  from !== to && !isDuplicateTemplateEdge(edges, from, to, label ?? null);
