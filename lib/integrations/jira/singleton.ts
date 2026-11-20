import "server-only";

import { getDb } from "../../db/dbAccess";
import { JiraService } from "./service";

const createJiraService = (): JiraService => {
  let inner: JiraService | undefined;
  return new Proxy({} as JiraService, {
    get(_target, prop: keyof JiraService) {
      if (!inner) {
        inner = new JiraService(getDb().jiraInstances);
      }
      const value = inner[prop];
      return typeof value === "function"
        ? (value as (...args: never[]) => unknown).bind(inner)
        : value;
    },
  });
};

/**
 * Shared Jira integration service (resolves {@link getDb} on first use —
 * decision Q9, plain module const; the lazy proxy keeps importing this
 * module from forcing DB construction, and per-graph copies of the
 * DB-backed delegate cannot disagree).
 */
export const jira = createJiraService();
