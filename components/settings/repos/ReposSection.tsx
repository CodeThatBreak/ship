"use client";
import { useCallback, useDeferredValue, useState } from "react";
import { Database, Plus } from "lucide-react";
import type { Repo } from "@/components/settings";
import { ConfirmDeleteDialog } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { RepoCard } from "./components/RepoCard";
import { RepoForm } from "./components/RepoForm";
import { RepoModal } from "./components/RepoModal";
import { ReposEmpty } from "./components/ReposEmpty";
import { REPO_MODAL_TITLE } from "./constants";
import { useDetectedPolicy } from "./hooks/use-detected-policy";
import { useDeleteRepo, useSaveRepo } from "./hooks/use-repo-mutations";
import { useRepoForm } from "./hooks/use-repo-form";
import { buildRepoSavePayload } from "./utils/repo-save-payload";

/**
 * Settings → Repositories: the repo registry plus the add/edit modal —
 * list + card pattern mirroring the integrations tabs.
 */
export const ReposSection = ({
  repos,
  serverHome,
  onError,
}: {
  repos: Repo[];
  serverHome: string;
  onError: (e: string | null) => void;
}) => {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Repo | null>(null);
  const { state, touchedPolicy, setField, loadRepo, reset } = useRepoForm();
  const save = useSaveRepo();
  const remove = useDeleteRepo();

  const deferredPath = useDeferredValue(state.local_path);
  const detected = useDetectedPolicy(deferredPath, editorOpen);

  const openAdd = useCallback(() => {
    setEditingId(null);
    reset();
    setEditorOpen(true);
  }, [reset]);

  const openEdit = useCallback((repo: Repo) => {
    setEditingId(repo.id);
    loadRepo(repo);
    setEditorOpen(true);
  }, [loadRepo]);

  const close = useCallback(() => {
    reset();
    setEditingId(null);
    setEditorOpen(false);
  }, [reset]);

  const submit = () => {
    const payload = buildRepoSavePayload(state, touchedPolicy, editingId);
    save.mutate(payload, {
      onSuccess: () => {
        close();
        onError(null);
      },
      onError: (e) => onError(e.message),
    });
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    remove.mutate(pendingDelete.id, {
      onSuccess: () => {
        setPendingDelete(null);
        onError(null);
      },
      onError: (e) => onError(e.message),
    });
  };

  const deletingId = remove.isPending ? remove.variables : null;

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-[13px] m-0 text-muted-foreground uppercase tracking-[1px] flex items-center gap-[7px]">
          <Database size={14} /> Repositories
        </h2>
        <Button size="sm" variant="outline" onClick={openAdd}>
          <Plus size={13} /> Add repo
        </Button>
      </div>

      <div className="grid gap-2.5 content-start">
        {repos.length === 0 ? (
          <ReposEmpty onAdd={openAdd} />
        ) : (
          repos.map((r) => (
            <RepoCard
              key={r.id}
              repo={r}
              serverHome={serverHome}
              deleting={deletingId === r.id}
              onEdit={() => openEdit(r)}
              onDelete={() => setPendingDelete(r)}
            />
          ))
        )}
      </div>

      <RepoModal
        open={editorOpen}
        onClose={close}
        title={editingId ? REPO_MODAL_TITLE.EDIT : REPO_MODAL_TITLE.ADD}
        submitLabel={editingId ? "Save changes" : "Add repo"}
        canSubmit={Boolean(state.name && state.cloud_url)}
        submitting={save.isPending}
        onSubmit={submit}
      >
        <RepoForm
          form={state}
          setField={setField}
          detected={detected}
        />
      </RepoModal>

      <ConfirmDeleteDialog
        open={pendingDelete != null}
        onClose={() => setPendingDelete(null)}
        title={`Remove repo “${pendingDelete?.name ?? ""}”?`}
        description="The registry entry is deleted. Running flows keep their snapshot; new flows won't offer this repo."
        busy={remove.isPending}
        confirmLabel="Remove repo"
        onConfirm={confirmDelete}
      />
    </section>
  );
};
