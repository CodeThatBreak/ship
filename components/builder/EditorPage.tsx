"use client";
/**
 * The template editor (§8, Phase 5) — this route's client island, hydrated
 * by the server page (dehydrate + HydrationBoundary): a drag-drop canvas
 * (@xyflow/react over the template graph) with drawers for node and edge
 * configuration. Clicking a node opens its configurator in a drawer;
 * structural edits (add node, connect, delete) mutate a local draft that
 * replaces the template graph wholesale on Save (⌘Z / ⇧⌘Z undo/redo);
 * node drags sync x/y immediately through the positions-only PATCH. Leaving
 * with unsaved changes is guarded (beforeunload + a styled confirm on the
 * back link). Built-in templates are read-only — duplicate from the gallery
 * to customize.
 *
 * The container composes the feature's state machines (the draft machine,
 * node positions, live validation) and hooks (placements, derived contract
 * reads); the header, notices, drawers and canvas are presentational
 * children. All editor interactivity stays client-side.
 */
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { errorMessageOf } from "@/hooks/fetch-json";
import {
  isPlanDownstream,
  nodeRelationships,
  type BuilderApi,
  type IncomingLink,
} from "@/components/template-editor";
import { useTemplateDraft, type Draft } from "@/components/template-editor";
import { useNodePositions } from "@/components/template-editor";
import { useTemplateValidation } from "@/components/template-editor";
import { EditorHeader } from "./EditorHeader";
import { EditorNotices } from "./EditorNotices";
import { EditorCanvas } from "./EditorCanvas";
import { EditorNodeDrawer } from "./EditorNodeDrawer";
import { EditorEdgeDrawer } from "./EditorEdgeDrawer";
import { EditorSettingsDrawer } from "./EditorSettingsDrawer";
import { EditorLeaveConfirm } from "./EditorLeaveConfirm";
import { EditorLoading } from "./EditorLoading";
import { EditorError } from "./EditorError";
import {
  detailToDraft,
  positionsOf,
  useRepoChoices,
  useTaskProviders,
  useTemplateDetail,
} from "./hooks/use-editor-queries";
import { useInstanceContracts } from "./hooks/use-instance-contracts";
import { useEditorActions } from "./hooks/use-editor-actions";
import { useEditorSave } from "./hooks/use-editor-save";
import { usePendingWriteFlushes } from "./hooks/use-pending-write-flushes";

export interface TemplateEditorProps {
  /** the owning template's route param — validated server-side (page.tsx) */
  templateId: string;
}

export function TemplateEditor({ templateId }: TemplateEditorProps) {
  const router = useRouter();
  const detailQuery = useTemplateDetail(templateId);
  const providersQuery = useTaskProviders();
  const reposQuery = useRepoChoices();

  // undo/redo may invalidate the open drawers — the actions hook registers
  // its closer here (the machine reads the ref at every history jump)
  const drawerCloser = useRef<() => void>(() => {});
  const onHistoryJump = useCallback(() => {
    drawerCloser.current();
  }, []);

  // the hydrated detail seeds the draft + canvas layout on the first render
  // (the state initializers below adopt it; refetches adopt via replaceDraft)
  const boot = useMemo(
    () => (detailQuery.data ? detailToDraft(detailQuery.data) : null),
    [detailQuery.data],
  );

  const machine = useTemplateDraft(boot?.draft ?? null, { onHistoryJump });
  const layout = useNodePositions(
    templateId,
    Boolean(machine.draft?.template.is_builtin),
    boot && detailQuery.data ? positionsOf(detailQuery.data) : null,
  );
  const validation = useTemplateValidation(machine.draft);
  const contracts = useInstanceContracts(machine.draft);
  const { register: registerPendingFlush, flushAll: flushPendingWrites } =
    usePendingWriteFlushes();
  const adoptedDetailAt = useRef<number | undefined>(detailQuery.dataUpdatedAt);
  const { dirty, replaceDraft } = machine;
  const { resetPositions } = layout;

  useEffect(() => {
    if (!detailQuery.data || dirty) return;
    const updatedAt = detailQuery.dataUpdatedAt;
    if (adoptedDetailAt.current === updatedAt) return;
    adoptedDetailAt.current = updatedAt;
    replaceDraft(detailToDraft(detailQuery.data).draft);
    resetPositions(positionsOf(detailQuery.data));
  }, [
    detailQuery.data,
    detailQuery.dataUpdatedAt,
    dirty,
    replaceDraft,
    resetPositions,
  ]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** the styled "leave with unsaved changes?" confirm on the back link */
  const [confirmLeave, setConfirmLeave] = useState(false);
  /** the canvas's screen→flow helper (palette placements go to viewport center) */
  const builderApi = useRef<BuilderApi | null>(null);

  const actions = useEditorActions({
    machine,
    layout,
    builderApi,
    drawerCloser,
  });

  // structural Save (validate → PATCH → clear badges → refresh hook/version):
  // the whole flow lives in the hook — the container only surfaces its states
  const saveApi = useEditorSave({
    machine,
    layout,
    validation,
    detailQuery,
    flushPendingWrites,
  });

  if (!machine.draft) {
    // the island renders with server-hydrated data; without it (a failed
    // hydration/unreachable template) show the error way back, else skeleton
    if (detailQuery.isError) {
      return (
        <EditorError
          message={detailQuery.error?.message ?? "Failed to load the template."}
          onRetry={() => void detailQuery.refetch()}
        />
      );
    }
    return <EditorLoading />;
  }

  const draft: Draft = machine.draft;
  const readonly = Boolean(draft.template.is_builtin);
  const providers = providersQuery.data ?? [];
  const repos = reposQuery.data ?? [];
  const providersError = providersQuery.isError
    ? (errorMessageOf(providersQuery.error) ?? "Couldn't load task providers.")
    : null;
  const reposError = reposQuery.isError
    ? (errorMessageOf(reposQuery.error) ?? "Couldn't load repos.")
    : null;
  const hook = detailQuery.data?.hook ?? null;
  // the template's declared task type (trigger.task_type — the Task context
  // panel edits it): the provider's contextFields become the {{task.*}} chips
  // every node configurator offers, and the start node's contract seeder
  const taskType = String(
    draft.template.trigger?.task_type ?? providers[0]?.kind ?? "",
  );
  const taskProvider =
    providers.find((p) => p.kind === taskType) ?? providers[0] ?? null;
  const taskFields = taskProvider?.contextFields ?? [];
  // connection info for the configured node: incoming edges resolve to the
  // Inputs tab's upstream pickers; an isolated node can't be configured yet
  const configuring =
    actions.nodeDrawer != null
      ? (draft.nodes.find((n) => n.key === actions.nodeDrawer) ?? null)
      : null;
  const editingEdge =
    actions.edgeDrawer != null
      ? (draft.edges[actions.edgeDrawer] ?? null)
      : null;
  const relationships = nodeRelationships(draft.nodes, draft.edges);
  const configuringLocked = configuring
    ? (relationships[configuring.key]?.isolated ?? false)
    : false;
  const configuringIncoming: IncomingLink[] = configuring
    ? draft.edges
        .map((edge, edgeIndex) => ({
          edge,
          edgeIndex,
          source: draft.nodes.find((n) => n.key === edge.from) ?? null,
        }))
        .filter((l) => l.edge.to === configuring.key && l.source)
    : [];
  // the fan-out gate (save-time lint rule 1, mirrored): the Fanout config
  // section only applies to nodes a plan node reaches through next edges
  const configuringPlanDownstream = configuring
    ? isPlanDownstream(draft.nodes, draft.edges, configuring.key)
    : true;

  return (
    <main className="fixed inset-0 flex flex-col bg-background">
      <EditorHeader
        template={draft.template}
        nodeCount={draft.nodes.length}
        edgeCount={draft.edges.length}
        readonly={readonly}
        canUndo={machine.canUndo}
        canRedo={machine.canRedo}
        dirty={machine.dirty}
        saving={saveApi.saving}
        layoutSync={layout.layoutSync}
        onBack={() => {
          if (machine.dirty) setConfirmLeave(true);
          else router.push("/templates");
        }}
        onUndo={machine.undo}
        onRedo={machine.redo}
        onOpenSettings={() => setSettingsOpen(true)}
        onSave={saveApi.save}
      />

      {(saveApi.error || machine.notice) && (
        <EditorNotices
          message={saveApi.error ?? machine.notice}
          isError={Boolean(saveApi.error)}
          onDismiss={() => {
            saveApi.setError(null);
            machine.setNotice(null);
          }}
        />
      )}

      <EditorCanvas
        templateId={draft.template.id}
        nodes={draft.nodes}
        edges={draft.edges}
        positions={layout.positions}
        selectedNodeKey={actions.nodeDrawer ?? actions.placedKey}
        selectedEdgeIndex={actions.edgeDrawer}
        readonly={readonly}
        branchChoices={contracts.branchChoices}
        nodeProblems={validation.nodeProblems}
        edgeProblems={validation.edgeProblems}
        catalogEpoch={saveApi.catalogEpoch}
        onNodeOpen={(key) => {
          actions.setEdgeDrawer(null);
          actions.setPlacedKey(null);
          actions.setNodeDrawer(key);
        }}
        onEdgeOpen={(index) => {
          actions.setNodeDrawer(null);
          actions.setPlacedKey(null);
          actions.setEdgeDrawer(index);
        }}
        onNodeMove={(key, x, y) =>
          layout.setPositions((p) => ({ ...p, [key]: { x, y } }))
        }
        onNodeDragStop={layout.scheduleSave}
        onConnect={actions.addEdge}
        onNodeRemove={actions.removeNodeKey}
        onEdgeRemove={actions.removeEdge}
        onNodeDuplicate={actions.duplicateNode}
        onTidyLayout={actions.tidyLayout}
        onPaneClick={() => actions.closeAll()}
        onAddCatalogNode={actions.addCatalogNode}
        onAddKindNode={actions.addKindNode}
        onApi={(api) => {
          builderApi.current = api;
        }}
      />

      <EditorNodeDrawer
        open={configuring != null}
        node={configuring}
        incoming={configuringIncoming}
        locked={configuringLocked}
        planDownstream={configuringPlanDownstream}
        taskFields={taskFields}
        triggerFields={contracts.triggerFields}
        invalidRefs={configuring ? validation.invalidRefs[configuring.key] : undefined}
        problems={configuring ? validation.nodeProblems[configuring.key] : undefined}
        templateId={draft.template.id}
        readonly={readonly}
        onClose={() => actions.setNodeDrawer(null)}
        onPatch={(patch) => {
          if (configuring) machine.patchNode(configuring.key, patch);
        }}
        registerPendingFlush={registerPendingFlush}
        onRemove={actions.removeNode}
      />

      {editingEdge != null && actions.edgeDrawer != null && (
        <EditorEdgeDrawer
          edge={editingEdge}
          edgeIndex={actions.edgeDrawer}
          edges={draft.edges}
          nodes={draft.nodes}
          sourceNode={
            draft.nodes.find((n) => n.key === editingEdge.from) ?? null
          }
          templateId={draft.template.id}
          readonly={readonly}
          taskFields={taskFields}
          triggerFields={contracts.triggerFields}
          onClose={() => actions.setEdgeDrawer(null)}
          onPatch={(patch) => {
            if (!draft || actions.edgeDrawer == null) return;
            const next = {
              ...draft,
              edges: draft.edges.map((e, i) =>
                i === actions.edgeDrawer ? { ...e, ...patch } : e,
              ),
            };
            machine.apply(next);
          }}
          onRemove={() => {
            if (actions.edgeDrawer != null) actions.removeEdge(actions.edgeDrawer);
          }}
        />
      )}

      <EditorSettingsDrawer
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        draft={draft}
        readonly={readonly}
        hook={hook}
        providers={providers}
        repos={repos}
        providersPending={providersQuery.isPending}
        providersError={providersError}
        onRetryProviders={() => void providersQuery.refetch()}
        reposPending={reposQuery.isPending}
        reposError={reposError}
        onRetryRepos={() => void reposQuery.refetch()}
        templateId={draft.template.id}
        onTemplateChange={(t) =>
          machine.apply({ ...draft, template: { ...draft.template, ...t } })
        }
      />

      <EditorLeaveConfirm
        open={confirmLeave}
        onKeep={() => setConfirmLeave(false)}
        onLeave={() => {
          setConfirmLeave(false);
          machine.setDirty(false); // don't trip the beforeunload guard on the way out
          router.push("/templates");
        }}
      />
    </main>
  );
}
