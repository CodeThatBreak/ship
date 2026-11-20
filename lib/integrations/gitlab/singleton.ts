import "server-only";

import { getDb } from "../../db/dbAccess";
import { GitLabService } from "./client";

const createGitLabService = (): GitLabService => {
  let inner: GitLabService | undefined;
  return new Proxy({} as GitLabService, {
    get(_target, prop: keyof GitLabService) {
      if (!inner) {
        const database = getDb();
        inner = new GitLabService(database.gitlabInstances, database);
      }
      const value = inner[prop];
      return typeof value === "function"
        ? (value as (...args: never[]) => unknown).bind(inner)
        : value;
    },
  });
};

/**
 * Shared GitLab integration service (resolves {@link getDb} on first use —
 * decision Q9, plain module const; the lazy proxy keeps importing this
 * module from forcing DB construction, and per-graph copies of the
 * DB-backed delegate cannot disagree).
 */
export const gitLab = createGitLabService();
