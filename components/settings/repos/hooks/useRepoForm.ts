"use client";
import { useCallback, useState } from "react";
import type { Repo } from "@/components/settings/context";
import { REPO_DEFAULT_BRANCH } from "../constants";
import type { RepoFormState } from "../types";
import {
  isRepoPolicyField,
  touchedPolicyFromRepo,
  type RepoPolicyField,
} from "../utils/repoSavePayload";

export const EMPTY_REPO_FORM: RepoFormState = {
  name: "", cloud_url: "", local_path: "", default_branch: REPO_DEFAULT_BRANCH,
  install_command: "", skip_install: false, sync_paths: "", shared_dirs: "", setup_command: "",
  worktree_timeout_s: "",
};

/** Map a stored repo row onto the editable form shape (paths stored verbatim). */
export const formFromRepo = (repo: Repo): RepoFormState => ({
  name: repo.name,
  cloud_url: repo.cloud_url,
  local_path: repo.local_path ?? "",
  default_branch: repo.default_branch || REPO_DEFAULT_BRANCH,
  install_command: repo.install_command ?? "",
  skip_install: Boolean(repo.skip_install),
  sync_paths: repo.sync_paths ?? "",
  shared_dirs: repo.shared_dirs ?? "",
  setup_command: repo.setup_command ?? "",
  worktree_timeout_s: repo.worktree_timeout_ms ? String(Math.round(repo.worktree_timeout_ms / 1000)) : "",
});

/**
 * Add/edit repo form state. `setField`, `loadRepo` and `reset` are stable so
 * they flow into the modal without re-render churn (AGENTS.md §2.5).
 */
export const useRepoForm = () => {
  const [state, setState] = useState<RepoFormState>(EMPTY_REPO_FORM);
  const [touchedPolicy, setTouchedPolicy] = useState<Set<RepoPolicyField>>(() => new Set());

  const setField = useCallback(
    <K extends keyof RepoFormState>(key: K, value: RepoFormState[K]) => {
      setState((prev) => ({ ...prev, [key]: value }));
      if (isRepoPolicyField(key)) {
        setTouchedPolicy((prev) => {
          const next = new Set(prev);
          next.add(key);
          return next;
        });
      }
    },
    [],
  );

  const loadRepo = useCallback((repo: Repo) => {
    setState(formFromRepo(repo));
    setTouchedPolicy(touchedPolicyFromRepo(repo));
  }, []);

  const reset = useCallback(() => {
    setState(EMPTY_REPO_FORM);
    setTouchedPolicy(new Set());
  }, []);

  return { state, touchedPolicy, setField, loadRepo, reset };
};
