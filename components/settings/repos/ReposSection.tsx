"use client";
import { useCallback, useEffect, useDeferredValue, useState } from "react";
import { Database, Plus } from "lucide-react";
import type { Repo } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { RepoCard } from "./components/RepoCard";
import { RepoForm } from "./components/RepoForm";
import { RepoModal } from "./components/RepoModal";
import { ReposEmpty } from "./components/ReposEmpty";
import { REPO_MODAL_TITLE } from "./constants";
import { useDetectedPolicy } from "./hooks/use-detected-policy";
import { useDeleteRepo, useSaveRepo } from "./hooks/use-repo-mutations";
import { formFromRepo, useRepoForm } from "./hooks/use-repo-form";

/**
 * Settings → Repositories: the repo registry plus the add/edit modal —
 * list + card pattern mirroring the integrations tabs.
 */
export function ReposSection({ repos, onError }: {
  repos: Repo[];
  onError: (e: string | null) => void;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { state, setField, replace, reset, applyDetected } = useRepoForm();
  const save = useSaveRepo();
  const remove = useDeleteRepo();

  // detection lags one render behind typing, so the query key doesn't churn
  // on every keystroke in the local-path field
  const detected = useDetectedPolicy(useDeferredValue(state.local_path), editorOpen);

  // prefill empty policy fields with what DevFlow would apply (re-runs on
  // open with cached data, and whenever the local path changes)
  useEffect(() => {
    if (editorOpen) applyDetected(detected);
  }, [detected, editorOpen, applyDetected]);

  const openAdd = useCallback(() => {
    setEditingId(null);
    reset();
    setEditorOpen(true);
  }, [reset]);

  const openEdit = useCallback((repo: Repo) => {
    setEditingId(repo.id);
    replace(formFromRepo(repo));
    setEditorOpen(true);
  }, [replace]);

  // closing (cancel, backdrop, or success) always rolls the form back;
  // `reset` is stable so this callback keeps its identity between renders
  const close = useCallback(() => {
    reset();
    setEditingId(null);
    setEditorOpen(false);
  }, [reset]);

  const submit = () => {
    save.mutate(
      { ...state, id: editingId },
      { onSuccess: () => { close(); onError(null); }, onError: (e) => onError(e.message) },
    );
  };

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
              onEdit={() => openEdit(r)}
              onDelete={() =>
                remove.mutate(r.id, {
                  onSuccess: () => onError(null),
                  onError: (e) => onError(e.message),
                })}
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
        <RepoForm form={state} setField={setField} detectedSource={detected?.source ?? null} />
      </RepoModal>
    </section>
  );
}
