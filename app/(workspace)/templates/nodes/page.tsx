import { loadNodeCatalog } from "@/loaders/templates";
import { TemplateNodesCatalog } from "@/components/templates";
import type { NodeRow } from "@/components/templates";

export const dynamic = "force-dynamic";

/**
 * Template Nodes — the shared node catalog (§8) — a Server Component. The
 * first paint's rows come from the loader (the same templateStore call the
 * thin /api/node-templates GET wraps around, including its
 * `is_builtin`/`is_local` serialization — no HTTP hop), then hydrate into
 * the catalog island's TanStack Query as `initialData`. Search, forms and
 * mutations stay client-side inside the island; route-level
 * loading.tsx/error.tsx mirror the final layout while the server renders.
 */
export default function TemplateNodesPage() {
  const nodes: NodeRow[] = loadNodeCatalog();
  return <TemplateNodesCatalog initialNodes={nodes} />;
}
