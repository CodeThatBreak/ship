import { loadTemplateGallery } from "@/loaders/templates";
import { TemplateGallery } from "@/components/templates";
import type { TemplateRow } from "@/components/templates";

export const dynamic = "force-dynamic";

/**
 * The template gallery (§8) — a Server Component. The first paint's rows
 * come from the loader (the exact templateStore call the thin /api/templates
 * GET wraps — no HTTP hop), then hydrate into the gallery island's TanStack
 * Query as `initialData`. Search, sorting, forms and every mutation stay
 * client-side inside the island; route-level loading.tsx/error.tsx mirror
 * the final layout while the server renders.
 */
export default function TemplatesPage() {
  const templates: TemplateRow[] = loadTemplateGallery();
  return <TemplateGallery initialTemplates={templates} />;
}
