"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { flowEventsQueryOptions } from "../../queries";

const EVENTS_REFETCH_MS = 3000;

/**
 * Live flow event feed: merged, de-duplicated history lives in the query cache
 * so remounts resume from the tail cursor instead of replaying batches (CR-026).
 */
export const useFlowEvents = (flowId: string) => {
  const query = useQuery({
    ...flowEventsQueryOptions(flowId),
    refetchInterval: EVENTS_REFETCH_MS,
    placeholderData: keepPreviousData,
  });

  return {
    events: query.data ?? [],
    /** True after the tail snapshot loaded — safe to tie flow-detail refresh to new ids (CR-119). */
    caughtUp: query.isSuccess,
  };
};
