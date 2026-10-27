import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { fetchJson } from "./fetch-json";

const STATUS_REFETCH_MS = 5000;

/** One line of the status bar's left side: what an agent is doing right now. */
export type AgentStatus = {
  flowId: string;
  taskKey: string;
  summary: string;
  node: string | null;
  mode: string;
  status: string;
  mrOpen: boolean;
};

/** Workspace activity snapshot served by /api/status. */
export type StatusPayload = {
  agents: AgentStatus[];
  agentsRunning: number;
  runsRunning: number;
  openMrs: { flowId: string; taskKey: string; mrUrl: string; mrIid: number | null }[];
  openMrCount: number;
  repoCount: number;
};

/** The agent-activity snapshot, polled every few seconds for the status bar. */
export function useAgentStatus() {
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: () => fetchJson<StatusPayload>("/api/status"),
    refetchInterval: STATUS_REFETCH_MS,
  });
}
