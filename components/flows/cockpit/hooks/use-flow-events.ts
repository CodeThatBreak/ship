"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { fetchJson } from "@/hooks/fetch-json";
import type { FeedEvent } from "@/components/chat";

const EVENTS_REFETCH_MS = 3000;
/** the chat feed's rolling history window (event rows kept client-side) */
const EVENTS_BUFFER_MAX = 500;

/**
 * The flow's live event stream (§2.2 feature hook): polled every few seconds
 * through TanStack Query with a server-side `after` cursor so each tick fetches
 * only NEW events, then the polled batches accumulate into a capped buffer —
 * the chat feed's history (streaming-external state the query cache was never
 * designed to grow, so the buffer is plain hook state fed by the batches).
 */
export function useFlowEvents(flowId: string) {
  const [buffer, setBuffer] = useState<FeedEvent[]>([]);
  // the last event id the server has handed out — stays out of the query key
  // (a changing key would drop the buffer and restart the poll)
  const cursor = useRef("");

  const batch = useQuery({
    queryKey: queryKeys.flows.events(flowId),
    queryFn: async () => {
      const res = await fetchJson<{ events?: FeedEvent[] }>(
        `/api/flows/${flowId}/events?after=${encodeURIComponent(cursor.current)}`,
      );
      const fresh = res.events ?? [];
      if (fresh.length) cursor.current = fresh[fresh.length - 1].id;
      return fresh;
    },
    refetchInterval: EVENTS_REFETCH_MS,
  });

  // the polled batches append as they land (capped rolling window)
  useEffect(() => {
    if (batch.data?.length) {
      setBuffer((prev) => [...prev, ...batch.data].slice(-EVENTS_BUFFER_MAX));
    }
  }, [batch.data]);

  return buffer;
}
