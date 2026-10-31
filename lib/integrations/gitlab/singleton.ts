import "server-only";

import { getDb } from "../../db/dbAccess";
import { processSingleton } from "../../singleton";
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

/** Shared GitLab integration service (resolves {@link getDb} on first use). */
export const gitLab = processSingleton("gitLab", createGitLabService);
