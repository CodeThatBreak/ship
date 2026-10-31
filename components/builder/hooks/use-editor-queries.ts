"use client";
/**
 * The template editor route's data layer: TanStack Query hooks over the
 * template/repo/provider APIs, hydrated by the server page (dehydrate +
 * HydrationBoundary — the first render never fetches). The detail payload →
 * draft mapper mirrors what GET /api/templates/[id] sends; the same mapping
 * exists server-side (TemplateStore.editorPayload), so refetches adopt the
 * same shapes the SSR boot hydrated.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { repoChoicesQueryOptions } from "../queries";
import {
  initialPositions,
  type CanvasPosition,
  type Draft,
  type EditorNode,
} from "@/components/template-editor";
import type {
  EditorRepoChoice,
  EditorTaskProvider,
  TemplateEditorDetail,
} from "@/types/template-editor";

/** GET /api/templates/[id] — the full editor payload (non-OK throws). */
export async function fetchTemplateDetail(
  templateId: string,
): Promise<TemplateEditorDetail> {
  const res = await fetch(`/api/templates/${templateId}`).catch(() => null);
  if (!res || !res.ok) throw new Error(`template ${templateId} failed to load`);
  const d = (await res.json()) as TemplateEditorDetail | null;
  if (!d?.template) throw new Error("template not found");
  return d;
}

/** The editor's detail query — hydrated by the server page, refetched after Save. */
export function useTemplateDetail(
  templateId: string,
): UseQueryResult<TemplateEditorDetail, Error> {
  return useQuery({
    queryKey: queryKeys.templates.detail(templateId),
    queryFn: () => fetchTemplateDetail(templateId),
  });
}

/** GET /api/tasks/providers — the Task-context picker + {{task.*}} chips. */
export async function fetchTaskProviders(): Promise<EditorTaskProvider[]> {
  const d = (await fetch("/api/tasks/providers")
    .then((r) => r.json() as Promise<{ providers?: EditorTaskProvider[] }>)
    .catch(() => null)) ?? null;
  return d?.providers ?? [];
}

export { fetchRepoChoices } from "../queries";

export function useTaskProviders(): UseQueryResult<EditorTaskProvider[], Error> {
  return useQuery({
    queryKey: queryKeys.taskProviders,
    queryFn: fetchTaskProviders,
  });
}

export function useRepoChoices(): UseQueryResult<EditorRepoChoice[], Error> {
  return useQuery(repoChoicesQueryOptions());
}

// ── the detail payload → editing draft ──────────────────────────────────────

/** A row trigger record narrowed onto the editor's trigger shape. */
function mapTrigger(
  v: Record<string, unknown> | null,
): EditorNode["trigger"] {
  const t = v && typeof v === "object" ? v : null;
  return {
    type: typeof t?.type === "string" ? t.type : "auto",
    ...(typeof t?.minutes === "number" ? { minutes: t.minutes } : {}),
    ...(typeof t?.wait_for === "string" ? { wait_for: t.wait_for } : {}),
  };
}

/**
 * The API payload → the editing draft (the mapper the hydrated detail feeds).
 * Returns the saved node positions alongside, so the caller can seed the
 * canvas layout (saved positions win; dagre fills the gaps).
 */
export function detailToDraft(
  data: TemplateEditorDetail,
): { draft: Draft; saved: Record<string, CanvasPosition> } {
  const saved: Record<string, CanvasPosition> = {};
  const draft: Draft = {
    template: data.template,
    nodes: data.nodes.map((n) => {
      if (typeof n.x === "number" && typeof n.y === "number")
        saved[n.key] = { x: n.x, y: n.y };
      return {
        key: n.key,
        nodeTemplateId: n.node_template_id,
        label: n.label ?? n.key,
        overrideLabel:
          n.label && n.label !== n.catalog_name ? n.label : null,
        trigger: mapTrigger(n.trigger),
        join_mode: n.join_mode ?? "all",
        config: n.config ?? {},
        input_map: n.input_map ?? {},
        kind: n.kind ?? null,
        icon: n.icon ?? null,
        catalog_name: n.catalog_name ?? null,
        catalogKey: n.catalog_key ?? null,
        is_builtin: Boolean(n.is_builtin),
        isLocal: Boolean(n.is_local),
      };
    }),
    edges: data.edges.map((e) => ({
      from: e.from,
      to: e.to,
      kind: e.kind,
      label: e.label ?? null,
      condition: e.condition ?? null,
    })),
  };
  return { draft, saved };
}

/** The layout a detail payload seeds: saved positions win, dagre fills gaps. */
export function positionsOf(
  data: TemplateEditorDetail,
): Record<string, CanvasPosition> {
  const { draft, saved } = detailToDraft(data);
  return initialPositions(draft.nodes, draft.edges, saved);
}
