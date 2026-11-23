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
import { queryKeys } from "@/constants/queryKeys";
import { fetchJson } from "@/hooks/fetchJson";
import {
  repoChoicesQueryOptions,
  taskProvidersQueryOptions,
} from "../queries";
import { initialPositions } from "@/components/templateEditor/layout";
import type { CanvasPosition, Draft } from "@/components/templateEditor/draft";
import type { EditorNode } from "@/components/templateEditor/types";
import type {
  EditorRepoChoice,
  EditorTaskProvider,
  TemplateEditorDetail,
} from "@/types/templateEditor";
import { EDITOR_NODE_KIND, TRIGGER_TYPE } from "../constants/editorGraph";

/** GET /api/templates/[id] — the full editor payload (non-OK throws). */
export async function fetchTemplateDetail(
  templateId: string,
): Promise<TemplateEditorDetail> {
  const d = await fetchJson<TemplateEditorDetail>(`/api/templates/${templateId}`);
  if (!d.template) throw new Error("template not found");
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

export {
  fetchRepoChoices,
  fetchTaskProviders,
} from "../queries";

export function useTaskProviders(): UseQueryResult<EditorTaskProvider[], Error> {
  return useQuery(taskProvidersQueryOptions());
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
    type: typeof t?.type === "string" ? t.type : TRIGGER_TYPE.AUTO,
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
        nodeTemplateId: n.nodeTemplateId,
        label: n.label ?? n.key,
        overrideLabel:
          n.label && n.label !== n.catalogName ? n.label : null,
        trigger: mapTrigger(n.trigger),
        joinMode: n.joinMode ?? EDITOR_NODE_KIND.ALL_JOIN,
        config: n.config ?? {},
        inputMap: n.inputMap ?? {},
        kind: n.kind ?? null,
        icon: n.icon ?? null,
        catalogName: n.catalogName ?? null,
        catalogKey: n.catalogKey ?? null,
        isBuiltin: Boolean(n.isBuiltin),
        isLocal: Boolean(n.isLocal),
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
