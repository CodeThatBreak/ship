"use client";
/**
 * The expression's current value, evaluated server-side against real context
 * (the template's most recent run's flow context — or a canned sample derived
 * from the template's contracts when nothing has run yet).
 *
 * Client-side fetching goes through TanStack Query (no raw useEffect+fetch):
 * the debounced expression is the query key's identity, `keepPreviousData`
 * keeps the last value on screen while the next one loads, and the hook is
 * inert without a template or an expression (no context to evaluate against).
 */
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { queryKeys } from "@/constants/queryKeys";
import { apiFetch } from "@/hooks/localApiToken";
import { PREVIEW_DEBOUNCE_MS } from "./constants";
import { useDebouncedValue } from "./useDebouncedValue";
import type { PreviewScope, PreviewState } from "./types";

interface PreviewResponse {
  ok?: boolean;
  value?: unknown;
  error?: string;
  source?: "run" | "sample";
}

/** The preview endpoint is 200-only for evaluated expressions — an
 *  `ok: false` body carries the JSONata error the line should show. */
async function requestPreview(
  templateId: string,
  scope: PreviewScope,
  expr: string,
): Promise<PreviewState> {
  const res = await apiFetch(`/api/templates/${templateId}/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expr, scope }),
  });
  const d = (await res.json().catch(() => null)) as PreviewResponse | null;
  if (!res.ok || !d || d.ok === false) {
    return {
      loading: false,
      error: d?.error ?? `preview failed (${res.status})`,
      source: d?.source,
    };
  }
  return { loading: false, value: d.value, source: d.source };
}

/** Stable idle reference so inert consumers don't churn on loading renders. */
const IDLE_PREVIEW: PreviewState = { loading: false };

export interface ExpressionPreview {
  state: PreviewState;
  /** Re-runs the evaluation (the error line's retry action). */
  retry: () => void;
}

export function useExpressionPreview(
  expr: string | null,
  opts: { templateId?: string; scope?: PreviewScope },
): ExpressionPreview {
  const { templateId, scope = "context" } = opts;
  const debounced = useDebouncedValue((expr ?? "").trim(), PREVIEW_DEBOUNCE_MS);
  const enabled = Boolean(templateId && debounced);

  const query = useQuery({
    queryKey: queryKeys.templates.preview(templateId ?? "", scope, debounced),
    queryFn: () => {
      if (!templateId) throw new Error("templateId is required");
      return requestPreview(templateId, scope, debounced);
    },
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    // live typing retunes the key constantly — a failed preview is retried by
    // the next keystroke or the explicit retry, not by the cache
    retry: false,
  });

  const state: PreviewState = !enabled
    ? IDLE_PREVIEW
    : query.isError
      ? {
          loading: false,
          error:
            query.error instanceof Error
              ? query.error.message
              : "preview failed — try again",
        }
      : (query.data ?? { loading: query.isFetching });

  return { state, retry: query.refetch };
}
