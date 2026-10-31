import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { fetchJson } from "@/hooks/fetch-json";

const COMMENTS_REFETCH_MS = 8000;

/** One MR comment/note (grouped into discussion threads by the review panel). */
export type MrComment = {
  id: string;
  threadId?: string | null;
  author?: string | null;
  body: string;
  path?: string | null;
  line?: number | null;
  status: string;
  resolvable: boolean;
  resolved: boolean;
  createdAt: string;
};

type CommentsPayload = { comments?: MrComment[] };

/**
 * The MR's comments polled while the merge request exists — `enabled` gates the
 * whole query (no MR → no fetch), mirroring the previous one-shot effect.
 */
export const useFlowComments = (flowId: string, enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.flows.comments(flowId),
    queryFn: () =>
      fetchJson<CommentsPayload>(`/api/flows/${flowId}/comments`).then(
        (d) => d.comments ?? [],
      ),
    enabled,
    refetchInterval: COMMENTS_REFETCH_MS,
  });
