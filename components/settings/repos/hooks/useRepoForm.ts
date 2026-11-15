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
  name: "", cloudUrl: "", localPath: "", defaultBranch: REPO_DEFAULT_BRANCH,
  useWorktrees: true, installCommand: "", skipInstall: false, syncPaths: "", sharedDirs: "",
  setupCommand: "", worktreeTimeoutS: "",
};

/** Map a stored repo row onto the editable form shape (paths stored verbatim). */
export const formFromRepo = (repo: Repo): RepoFormState => ({
  name: repo.name,
  cloudUrl: repo.cloudUrl,
  localPath: repo.localPath ?? "",
  defaultBranch: repo.defaultBranch || REPO_DEFAULT_BRANCH,
  useWorktrees: Boolean(repo.useWorktrees),
  installCommand: repo.installCommand ?? "",
  skipInstall: Boolean(repo.skipInstall),
  syncPaths: repo.syncPaths ?? "",
  sharedDirs: repo.sharedDirs ?? "",
  setupCommand: repo.setupCommand ?? "",
  worktreeTimeoutS: repo.worktreeTimeoutMs ? String(Math.round(repo.worktreeTimeoutMs / 1000)) : "",
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
