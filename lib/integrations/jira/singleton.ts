import "server-only";

import { getDb } from "../../db/db-access";
import { processSingleton } from "../../singleton";
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

/** Shared Jira integration service (resolves {@link getDb} on first use). */
export const jira = processSingleton("jira", createJiraService);
