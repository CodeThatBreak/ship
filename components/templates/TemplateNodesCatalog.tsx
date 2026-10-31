"use client";
/**
 * Template Nodes — the shared node catalog (§8) — the page's island. The
 * page's Server Component passed the first paint's rows in
 * (`initialNodes`); this container hydrates them into TanStack Query and
 * owns the interactivity: one DataTable over `node_templates` (built-in
 * SDLC nodes pinned first, then the reusable custom nodes), "New node",
 * Configure (the schema-driven dialog) and Delete with the styled confirm —
 * the server refuses rows still referenced by template nodes, and that
 * error surfaces here. Built-ins are code-defined, so they carry no actions.
 * The editor palette's Library section renders exactly the custom rows
 * managed here — this page is their single authoring surface.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Blocks, Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, AlertAction } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDeleteDialog } from "@/components/shared";
import { ListSection } from "@/components/shared";
import { DataTable, type DataTableAction } from "@/components/shared";
import { queryKeys } from "@/constants/query-keys";
import { useNodeList } from "./hooks/use-node-list";
import { nodeColumns } from "./components/NodeColumns";
import { NodeConfigureDialog } from "./components/NodeConfigureDialog";
import type { NodeRow } from "./types";

/** null = dialog closed; a row = configure it; `{ node: null }` = create */
type Editing = { node: NodeRow | null } | null;

export function TemplateNodesCatalog() {
  const queryClient = useQueryClient();
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: queryKeys.nodeTemplates });

  const [pageError, setPageError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  /** the node behind the styled delete confirm */
  const [pendingDelete, setPendingDelete] = useState<NodeRow | null>(null);

  // the server-hydrated list — every mutation invalidates this key and the
  // refetch runs through /api/node-templates
  const nodesQuery = useNodeList();
  const nodes = nodesQuery.data ?? [];

  /** The confirm's destructive action: delete, then refresh (the server
   *  refuses rows still referenced by template nodes — surface that). */
  const removeMutation = useMutation({
    mutationFn: async (n: NodeRow) => {
      const res = await fetch(`/api/node-templates/${n.id}`, { method: "DELETE" });
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok || payload?.error) {
        throw new Error(payload?.error ?? `Request failed (${res.status})`);
      }
    },
    onMutate: () => setPageError(null),
    onError: (e) => setPageError(e.message),
    onSettled: invalidate,
  });

  // row actions — built-ins are code-defined and carry none; the DataTable
  // renders "Configure" upfront and pushes Delete into the ⋯ overflow menu
  const getActions = (n: NodeRow): DataTableAction<NodeRow>[] =>
    n.is_builtin
      ? []
      : [
          {
            label: "Configure",
            icon: <Pencil size={12} />,
            onSelect: () => setEditing({ node: n }),
          },
          {
            label: "Delete",
            icon: <Trash2 size={13} />,
            destructive: true,
            disabled: removeMutation.isPending && removeMutation.variables?.id === n.id,
            onSelect: () => setPendingDelete(n),
          },
        ];

  return (
    <div>
      <header className="flex items-end justify-between gap-4 mb-7">
        <div>
          <h1 className="text-lg font-semibold tracking-tight m-0">Template nodes</h1>
          <p className="text-muted-foreground text-[12.5px] mt-1 mb-0">
            The shared node catalog — built-in SDLC nodes plus reusable custom
            nodes. Every template&apos;s builder lists your nodes under Library.
          </p>
        </div>
        <Button onClick={() => setEditing({ node: null })}>
          <Plus size={13} /> New node
        </Button>
      </header>

      {/* §2.8: the refetch error keeps the (cached) table visible and offers
          a retry; mutation/page errors render as a separate page-top alert */}
      {nodesQuery.isError && (
        <Alert variant="destructive" className="mb-4">
          <span className="flex-1">
            Failed to load template nodes{nodesQuery.error?.message ? `: ${nodesQuery.error.message}` : ""}. Showing possibly stale rows.
          </span>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => void nodesQuery.refetch()}>
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}
      {pageError && <Alert variant="destructive" className="mb-4">{pageError}</Alert>}

      <ListSection
        icon={<Blocks size={13} />}
        label="Nodes"
        count={nodes.length}
        meta={nodesQuery.isFetching ? <Spinner className="size-3 shrink-0" /> : null}
      >
        <DataTable
          columns={nodeColumns}
          getActions={getActions}
          data={nodes}
          searchable
          searchPlaceholder="Search nodes…"
          pageSize={25}
          initialSorting={[{ id: "updated_at", desc: false }]}
          emptyMessage="No nodes yet — add one to make it available in every template's builder."
        />
      </ListSection>

      {/* create / configure dialog: identity + the kind's definition */}
      {editing && (
        <NodeConfigureDialog
          node={editing.node}
          onClose={() => setEditing(null)}
        />
      )}

      {/* delete confirm: styled confirm dialog, not the native confirm() */}
      <ConfirmDeleteDialog
        open={pendingDelete != null}
        onClose={() => setPendingDelete(null)}
        title={`Delete node “${pendingDelete?.name ?? ""}”?`}
        description="The node disappears from every template's Library. Nodes still placed in templates can't be deleted — remove them there first."
        busy={
          pendingDelete != null &&
          removeMutation.isPending &&
          removeMutation.variables?.id === pendingDelete.id
        }
        confirmLabel="Delete node"
        onConfirm={() => pendingDelete && removeMutation.mutate(pendingDelete)}
      />
    </div>
  );
}
