"use client";
import { useCallback, useState } from "react";
import type { Repo } from "@/components/settings/context";
import { REPO_DEFAULT_BRANCH } from "../constants";
import { tildePath } from "../paths";
import type { RepoFormState } from "../types";
import type { DetectedPolicy } from "./use-detected-policy";

export const EMPTY_REPO_FORM: RepoFormState = {
  name: "", cloud_url: "", local_path: "", default_branch: REPO_DEFAULT_BRANCH,
  install_command: "", skip_install: false, sync_paths: "", shared_dirs: "", setup_command: "",
};

/** Map a stored repo row onto the editable form shape (paths shown as `~/…`). */
export function formFromRepo(repo: Repo): RepoFormState {
  return {
    name: repo.name,
    cloud_url: repo.cloud_url,
    local_path: repo.local_path ? tildePath(repo.local_path) : "",
    default_branch: repo.default_branch || REPO_DEFAULT_BRANCH,
    install_command: repo.install_command ?? "",
    skip_install: Boolean(repo.skip_install),
    sync_paths: repo.sync_paths ?? "",
    shared_dirs: repo.shared_dirs ?? "",
    setup_command: repo.setup_command ?? "",
  };
}

/**
 * Add/edit repo form state. `setField`, `replace` and `reset` are stable so
 * they flow into the modal without re-render churn (AGENTS.md §1.3).
 */
export function useRepoForm() {
  const [state, setState] = useState<RepoFormState>(EMPTY_REPO_FORM);

  const setField = useCallback(
    <K extends keyof RepoFormState>(key: K, value: RepoFormState[K]) => {
      setState((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );
  const replace = useCallback((next: RepoFormState) => setState(next), []);
  const reset = useCallback(() => setState(EMPTY_REPO_FORM), []);

  /** Fill still-empty policy fields from detection — user edits always win. */
  const applyDetected = useCallback((d: DetectedPolicy | null) => {
    if (!d) return;
    setState((prev) => ({
      ...prev,
      install_command: prev.install_command || d.install_command || "",
      sync_paths: prev.sync_paths || d.sync_paths,
    }));
  }, []);

  return { state, setField, replace, reset, applyDetected };
}
