import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { fetchJson } from "@/hooks/fetch-json";
import type { FeedEvent } from "@/components/chat";
import { mergeFlowEvents } from "./cockpit/utils/merge-flow-events";

/** Rolling chat feed window — kept in the events query cache (CR-026, CR-119). */
export const FLOW_EVENTS_BUFFER_MAX = 500;

const FLOW_EVENTS_POLL_LIMIT = 200;

/** Artifact row from GET /api/artifacts — panels read `.content` and `.meta`. */
export type ArtifactDetail = {
  content: string;
  meta?: Record<string, unknown>;
};

export const artifactQueryOptions = (id: string) =>
  queryOptions({
    queryKey: queryKeys.artifacts.detail(id),
    queryFn: () => fetchJson<ArtifactDetail>(`/api/artifacts/${id}`),
    staleTime: Infinity,
    enabled: id.length > 0,
  });

export const flowEventsQueryOptions = (flowId: string) =>
  queryOptions({
    queryKey: queryKeys.flows.events(flowId),
    queryFn: async ({ client }) => {
      const key = queryKeys.flows.events(flowId);
      const prev = client.getQueryData<FeedEvent[]>(key) ?? [];
      if (prev.length === 0) {
        const res = await fetchJson<{ events?: FeedEvent[] }>(
          `/api/flows/${flowId}/events?tail=${FLOW_EVENTS_BUFFER_MAX}`,
        );
        return (res.events ?? []).slice(-FLOW_EVENTS_BUFFER_MAX);
      }
      const after = prev.at(-1)?.id;
      if (!after) {
        return prev;
      }
      const res = await fetchJson<{ events?: FeedEvent[] }>(
        `/api/flows/${flowId}/events?after=${encodeURIComponent(after)}&limit=${FLOW_EVENTS_POLL_LIMIT}`,
      );
      return mergeFlowEvents(prev, res.events ?? [], FLOW_EVENTS_BUFFER_MAX);
    },
  });
