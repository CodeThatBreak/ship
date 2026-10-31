"use client";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Inbox, SquareCheckBig, Trash2, Workflow } from "lucide-react";
import { Alert, AlertAction } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type DataTableAction } from "@/components/shared/dataTable/DataTable";
import { queryKeys } from "@/constants/queryKeys";
import { apiFetch } from "@/hooks/localApiToken";
import { FLOW_STATUS } from "@/constants/flow";
import type { FlowSummary } from "@/types/flows";
import { EXECUTION_MODE_LOCAL } from "./constants";
import { DeleteFlowDialog } from "./DeleteFlowDialog";
import { flowColumns } from "./FlowColumns";
import { useFlowsQuery } from "./hooks/useFlowsQuery";
import { useWorktreeStatus } from "./hooks/useWorktreeStatus";

type DeleteErrorBody = { error?: string };

/**
 * The flows list island (client): the rows arrive server-rendered as
 * `initialFlows`, refresh/delete/worktree polling stay live here through
 * TanStack Query.
 */
export function FlowsView({ initialFlows }: { initialFlows: FlowSummary[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const flows = useFlowsQuery(initialFlows);
  const [pendingDelete, setPendingDelete] = useState<FlowSummary | null>(null);

  // Worktree status (dirty / ahead / behind) for local flows: refreshed every
  // 5s — flow events land in the DB and the rows pick the git state up here.
  const hasLocal = (flows.data ?? []).some(
    (f) => f.execution_mode === EXECUTION_MODE_LOCAL,
  );
  const worktrees = useWorktreeStatus(hasLocal);

  /** The delete confirm's destructive action: remove flow+children+worktree. */
  const removeFlow = useMutation({
    mutationFn: async (flow: FlowSummary) => {
      const res = await apiFetch(`/api/flows/${flow.id}`, { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as DeleteErrorBody;
      if (!res.ok || body.error) {
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
    },
    onSuccess: () => {
      setPendingDelete(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.flows.list });
      void queryClient.invalidateQueries({ queryKey: queryKeys.flows.worktreeStatus });
    },
  });

  const data = flows.data ?? [];
  const active = data.filter((f) => f.status === FLOW_STATUS.ACTIVE);
  const finished = data.filter((f) => f.status !== FLOW_STATUS.ACTIVE);
  const columns = useMemo(
    () => flowColumns(worktrees.data ?? {}),
    [worktrees.data],
  );

  const openFlow = useCallback(
    (f: FlowSummary) => router.push(`/flows/${f.id}`),
    [router],
  );

  // row actions — the DataTable renders the first action as an upfront button
  // and any further ones in a ⋯ menu (delete collapses there, destructive)
  const getActions = useCallback(
    (f: FlowSummary): DataTableAction<FlowSummary>[] => [
      { label: "Open", onSelect: () => openFlow(f) },
      {
        label: "Delete",
        icon: <Trash2 size={13} />,
        title: "Delete the whole flow (nodes, runs, comments and local worktree)",
        destructive: true,
        disabled: removeFlow.isPending,
        onSelect: () => setPendingDelete(f),
      },
    ],
    [openFlow, removeFlow.isPending],
  );

  const retryList = useCallback(() => {
    void flows.refetch();
  }, [flows]);

  const listError = flows.error?.message ?? null;
  const deleteError =
    pendingDelete && removeFlow.error ? removeFlow.error.message : null;

  const closeDeleteDialog = useCallback(() => {
    removeFlow.reset();
    setPendingDelete(null);
  }, [removeFlow]);

  return (
    <div>
      {listError && (
        <Alert variant="destructive" className="mb-4">
          <span>{listError}</span>
          <AlertAction>
            <Button variant="outline" size="sm" onClick={retryList}>
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}

      {data.length === 0 ? (
        <Card className="justify-center items-center gap-2 py-10 border-dashed! shadow-none! text-muted-foreground">
          <div className="size-10 grid place-items-center rounded-lg bg-muted">
            <Inbox size={18} />
          </div>
          <div className="text-sm font-medium text-foreground">No flows yet</div>
          <div className="text-[12.5px]">
            Kick one off from a task on the{" "}
            <Link href="/" className="underline">
              Tasks
            </Link>{" "}
            page.
          </div>
        </Card>
      ) : (
        <div className="grid gap-6">
          <section>
            <h2 className="text-[12px] font-medium mb-3 text-muted-foreground uppercase tracking-[1.2px] flex items-center gap-2">
              <Workflow size={13} /> Running
              {active.length > 0 && (
                <span className="normal-case tracking-normal text-[11px] text-muted-foreground/60">
                  {active.length}
                </span>
              )}
            </h2>
            <DataTable
              columns={columns}
              getActions={getActions}
              data={active}
              emptyMessage="Nothing running — agents show up here when a flow starts."
              onRowClick={openFlow}
            />
          </section>
          {finished.length > 0 && (
            <section>
              <h2 className="text-[12px] font-medium mb-3 text-muted-foreground uppercase tracking-[1.2px] flex items-center gap-2">
                <SquareCheckBig size={13} /> Finished
                <span className="normal-case tracking-normal text-[11px] text-muted-foreground/60">
                  {finished.length}
                </span>
              </h2>
              <DataTable
                columns={columns}
                getActions={getActions}
                data={finished}
                className="opacity-80"
                emptyMessage="Nothing finished yet."
                onRowClick={openFlow}
              />
            </section>
          )}
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => void flows.refetch()}>
          Refresh
        </Button>
      </div>

      <DeleteFlowDialog
        flow={pendingDelete}
        busy={removeFlow.isPending && removeFlow.variables?.id === pendingDelete?.id}
        errorMessage={deleteError}
        onConfirm={(f) => removeFlow.mutate(f)}
        onClose={closeDeleteDialog}
      />
    </div>
  );
}
