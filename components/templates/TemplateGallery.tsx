"use client";
/**
 * The template gallery (§8) — the Templates page's island. The page's Server
 * Component passed the first paint's rows in (`initialTemplates`); this
 * container hydrates them into TanStack Query and owns the interactivity:
 *  - renders as a single DataTable (same pattern as the Tasks page) with the
 *    starters (built-ins) pinned first, then your templates by updated date;
 *  - "New template" creates an *Untitled flow* instantly and opens the editor —
 *    no name dialog speed bump (the name lives in the editor's Flow settings);
 *  - delete asks through the styled confirm dialog (no native confirm());
 *  - import takes a file (upload or drag-drop) or paste — the ImportTemplate
 *    dialog owns that surface;
 *  - starters' open action is labeled "Preview" (they're read-only).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Workflow } from "lucide-react";
import { Copy, Download, Trash2, Webhook } from "lucide-react";
import { Alert, AlertAction } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDeleteDialog } from "@/components/shared/ConfirmDeleteDialog";
import { ListSection } from "@/components/shared/ListSection";
import { DataTable, type DataTableAction } from "@/components/shared/dataTable/DataTable";
import { WebhookPayloadDialog } from "@/components/templateEditor/WebhookPayloadDialog";
import { queryKeys } from "@/constants/queryKeys";
import { postJson } from "@/hooks/fetchJson";
import { apiFetch } from "@/hooks/localApiToken";
import { useTemplateList } from "./hooks/useTemplateList";
import { templateColumns } from "./components/TemplateColumns";
import { GalleryHeader } from "./components/GalleryHeader";
import { ImportTemplateDialog, type ImportDraft } from "./components/ImportTemplateDialog";
import type { TemplateRow } from "./types";

/** Row actions for one template — DataTable renders the first upfront and
 *  pushes the rest into the ⋯ overflow menu (built-ins are read-only, so
 *  they carry no Delete and a "Preview" open). */
function getTemplateActions(
  t: TemplateRow,
  ctx: {
    busyDuplicate: boolean;
    busyDelete: boolean;
    onOpen: () => void;
    onDuplicate: () => void;
    onPickPayload: () => void;
    onPickDelete: () => void;
  },
): DataTableAction<TemplateRow>[] {
  const builtin = Boolean(t.is_builtin);
  return [
    { label: builtin ? "Preview" : "Open", onSelect: ctx.onOpen },
    {
      label: "Duplicate",
      icon: <Copy size={13} />,
      disabled: ctx.busyDuplicate,
      onSelect: ctx.onDuplicate,
    },
    {
      label: "Copy webhook payload",
      icon: <Webhook size={13} />,
      title: "Copy webhook payload — pick the repo + harness the delivery pins",
      onSelect: ctx.onPickPayload,
    },
    {
      label: "Export YAML",
      icon: <Download size={13} />,
      href: () => `/api/templates/${t.id}/export`,
    },
    ...(builtin
      ? []
      : [
          {
            label: "Delete",
            icon: <Trash2 size={13} />,
            destructive: true,
            disabled: ctx.busyDelete,
            onSelect: ctx.onPickDelete,
          } satisfies DataTableAction<TemplateRow>,
        ]),
  ];
}

export function TemplateGallery() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: queryKeys.templatesGallery });

  const [pageError, setPageError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  /** the import dialog's YAML draft + in-dialog error — kept here so the
   *  paste box survives the dialog unmounting between opens */
  const [importDraft, setImportDraft] = useState<ImportDraft>({ yaml: "", error: null });
  /** the template behind the styled delete confirm (was the native confirm) */
  const [pendingDelete, setPendingDelete] = useState<TemplateRow | null>(null);
  /** the template behind the copy-webhook-payload dialog (harness/repo pick) */
  const [payloadTarget, setPayloadTarget] = useState<TemplateRow | null>(null);

  // the server-hydrated list — every mutation invalidates this key and the
  // refetch runs through /api/templates
  const templatesQuery = useTemplateList();
  const templates = templatesQuery.data ?? [];

  /** A1: "New template" creates an *Untitled flow* instantly and opens the
   *  editor — the name is edited in the editor's Flow settings, not here. */
  const createMutation = useMutation({
    mutationFn: () => postJson<{ id: string }>("/api/templates", JSON.stringify({})),
    onMutate: () => setPageError(null),
    onSuccess: ({ id }) => {
      invalidate();
      router.push(`/templates/${id}`);
    },
    onError: (e) => setPageError(e.message),
  });

  /** Duplicate = export YAML + import (exercises the round-trip path). */
  const duplicateMutation = useMutation({
    mutationFn: async (t: TemplateRow) => {
      const res = await fetch(`/api/templates/${t.id}/export`);
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const yaml = await res.text();
      return postJson<{ id: string }>(
        "/api/templates/import",
        JSON.stringify({ yaml, namePrefix: "Copy" }),
      );
    },
    onSuccess: ({ id }) => router.push(`/templates/${id}`),
    onMutate: () => setPageError(null),
    onError: (e) => setPageError(e.message),
    onSettled: invalidate,
  });

  /** The confirm's destructive action (A2): delete, then refresh. */
  const removeMutation = useMutation({
    mutationFn: async (t: TemplateRow) => {
      const res = await apiFetch(`/api/templates/${t.id}`, { method: "DELETE" });
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok || payload?.error) {
        throw new Error(payload?.error ?? `Request failed (${res.status})`);
      }
    },
    onMutate: () => setPageError(null),
    onError: (e) => setPageError(e.message),
    onSettled: invalidate,
  });

  const rowBusy = (mutation: { isPending: boolean; variables?: TemplateRow }, t: TemplateRow) =>
    mutation.isPending && mutation.variables?.id === t.id;

  return (
    <div>
      <GalleryHeader
        busyCreate={createMutation.isPending}
        onImportClick={() => setImporting(true)}
        onCreateClick={() => createMutation.mutate()}
      />

      {/* §2.8: the refetch error keeps the (cached) table visible and offers
          a retry; mutation/page errors render as a separate page-top alert */}
      {templatesQuery.isError && (
        <Alert variant="destructive" className="mb-4">
          <span className="flex-1">
            Failed to load templates{templatesQuery.error?.message ? `: ${templatesQuery.error.message}` : ""}. Showing possibly stale rows.
          </span>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => void templatesQuery.refetch()}>
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}
      {pageError && <Alert variant="destructive" className="mb-4">{pageError}</Alert>}

      <ListSection
        icon={<Workflow size={13} />}
        label="Templates"
        count={templates.length}
        meta={templatesQuery.isFetching ? <Spinner className="size-3 shrink-0" /> : null}
      >
        <DataTable
          columns={templateColumns}
          getActions={(t) =>
            getTemplateActions(t, {
              busyDuplicate: rowBusy(duplicateMutation, t),
              busyDelete: rowBusy(removeMutation, t),
              onOpen: () => router.push(`/templates/${t.id}`),
              onDuplicate: () => duplicateMutation.mutate(t),
              onPickPayload: () => setPayloadTarget(t),
              onPickDelete: () => setPendingDelete(t),
            })
          }
          data={templates}
          searchable
          searchPlaceholder="Search templates…"
          pageSize={25}
          initialSorting={[{ id: "updated_at", desc: false }]}
          emptyMessage="No templates yet — duplicate a starter or create one."
        />
      </ListSection>

      {/* import dialog: file upload / drag-drop + paste; validation problems
          render inside, next to the YAML (A4); explicit Cancel (A5) */}
      <ImportTemplateDialog
        open={importing}
        draft={importDraft}
        onDraftChange={(patch) => setImportDraft((d) => ({ ...d, ...patch }))}
        onClose={() => setImporting(false)}
        onImported={(id) => router.push(`/templates/${id}`)}
      />

      {/* copy webhook payload (gallery table action): pick repo + harness,
          preview + copy the delivery body (the reserved repo/execution_mode
          keys + the start contract's input params) */}
      <WebhookPayloadDialog
        key={payloadTarget?.id ?? "none"}
        template={payloadTarget}
        defaultRepoId={
          typeof payloadTarget?.trigger?.repo_id === "string"
            ? payloadTarget.trigger.repo_id
            : null
        }
        onClose={() => setPayloadTarget(null)}
      />

      {/* delete confirm (A2): the styled confirm dialog, not the native
          confirm() */}
      <ConfirmDeleteDialog
        open={pendingDelete != null}
        onClose={() => setPendingDelete(null)}
        title={`Delete template “${pendingDelete?.name ?? ""}”?`}
        description="The template and its graph are removed. Instances on running flows snapshot at creation and are unaffected."
        busy={pendingDelete != null && rowBusy(removeMutation, pendingDelete)}
        confirmLabel="Delete template"
        onConfirm={() => pendingDelete && removeMutation.mutate(pendingDelete)}
      />
    </div>
  );
}
