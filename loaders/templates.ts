import "server-only";
/**
 * The template editor's SSR boot data (app/templates/[id]/page.tsx): the
 * pieces the editor's client island hydrates its TanStack Query cache with,
 * assembled by calling the services directly — the same service calls the
 * API routes make (single mapping source in TemplateStore), so the
 * server-rendered and refetched payloads can't drift apart.
 *
 * Server-only: never import from client code (the page passes the result
 * through dehydrate/HydrationBoundary instead).
 */
import { templateStore } from "@/lib/engine/templates/template-store";
import { taskRegistry } from "@/lib/engine/tasks/registry";
import { db } from "@/lib/db";
import type {
  EditorRepoChoice,
  EditorTaskProvider,
  TemplateCatalogDetail,
  TemplateEditorDetail,
} from "@/types/template-editor";
import type { NodeRow, TemplateRow } from "@/types/templates";

/** Registered task providers — the same serialization GET /api/tasks/providers does. */
function registeredProviders(): EditorTaskProvider[] {
  return taskRegistry
    .list()
    .map((p) => ({
      kind: p.kind,
      label: p.label,
      configured: p.configured(),
      contextFields: p.contextFields,
    }));
}

/** Registered repos — the editor's Bound-repo picker slice (id/name/local_path). */
function registeredRepos(): EditorRepoChoice[] {
  return db
    .listRepos()
    .map((r) => ({ id: r.id, name: r.name, local_path: r.local_path ?? null }));
}

export interface EditorBoot {
  /** template meta + graph + hook (null template = caller renders not-found) */
  detail: TemplateEditorDetail;
  /** the palette's built-in / Library / template-local catalog rows */
  catalog: TemplateCatalogDetail;
  providers: EditorTaskProvider[];
  repos: EditorRepoChoice[];
}

/**
 * All first-paint editor data in one read. Null when the template id is
 * unknown — the route renders notFound() instead of the editor island.
 */
export function loadEditorBoot(templateId: string): EditorBoot | null {
  if (!templateStore.flowTemplate(templateId)) return null;
  const detail = templateStore.editorPayload(templateId);
  if (!detail) return null;
  return {
    detail,
    catalog: templateStore.paletteCatalog(templateId),
    providers: registeredProviders(),
    repos: registeredRepos(),
  };
}

/**
 * The gallery page's first-paint rows — the exact call the thin
 * `/api/templates` GET wraps (no HTTP hop). The client island hydrates it
 * into TanStack Query as `initialData`.
 */
export function loadTemplateGallery(): TemplateRow[] {
  return templateStore.list();
}

/**
 * The Template Nodes catalog page's first-paint rows — the same read the
 * thin `/api/node-templates` GET wraps, including its
 * `is_builtin`/`is_local` serialization.
 */
export function loadNodeCatalog(): NodeRow[] {
  return templateStore.listNodeTemplates().map((nt) => ({
    ...nt,
    is_builtin: Boolean(nt.is_builtin),
    is_local: Boolean(nt.template_id),
    config: nt.config ?? {},
  }));
}
