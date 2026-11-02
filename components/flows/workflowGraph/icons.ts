import {
  BellRing,
  CheckCheck,
  CircleDot,
  Compass,
  Gauge,
  Hammer,
  Play,
  Rocket,
  ScanSearch,
  Send,
  Sparkles,
  Split,
  Tag,
  Terminal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { GraphDef } from "../hooks/useGraphDef";

// icons are a pure UI concern — resolved from the node_templates `icon` column
// (lucide names, e.g. the seeded nodes) with a kind fallback, then CircleDot.
// Exported so the template builder resolves the same set.
export const ICONS: Record<string, LucideIcon> = {
  plan: Compass,
  build: Hammer,
  step_build: Hammer,
  pipeline: Gauge,
  review: ScanSearch,
  resolve: CheckCheck,
  agent: Sparkles,
  http: Send,
  script: Terminal,
  decision: Split,
  // extra lucide names templates may reference in node_templates.icon
  Bot: Sparkles,
  BellRing: BellRing,
  Play: Play,
  Rocket: Rocket,
  Tag: Tag,
};

/** The diagram icon for a node key: meta's lucide `icon` name first, then the
 *  node's kind, then the catalog key (builtin defs), then the neutral dot. */
export function iconFor(key: string, meta: GraphDef["meta"]): LucideIcon {
  const metaEntry = meta[key];
  if (metaEntry?.icon && ICONS[metaEntry.icon]) return ICONS[metaEntry.icon];
  const catalogKey = key.startsWith("builtin/") ? key.slice(8) : key;
  return ICONS[metaEntry?.icon ?? ""] ?? ICONS[metaEntry?.kind ?? ""] ?? ICONS[catalogKey] ?? CircleDot;
}
