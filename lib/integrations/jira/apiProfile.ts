import "server-only";

import type { JiraInstance } from "./service";

export type JiraAuthMode = "cloud_basic" | "dc_bearer";

export const jiraAuthModeForInstance = (inst: Pick<JiraInstance, "base_url">): JiraAuthMode => {
  try {
    const host = new URL(inst.base_url).hostname.toLowerCase();
    if (host.endsWith(".atlassian.net")) return "cloud_basic";
  } catch {
    /* self-hosted URL may omit scheme in edge cases — treat as DC */
  }
  return "dc_bearer";
};

export const jiraMyselfPath = (mode: JiraAuthMode): string =>
  mode === "cloud_basic" ? "/rest/api/3/myself" : "/rest/api/2/myself";

export const jiraSearchPath = (mode: JiraAuthMode): string =>
  mode === "cloud_basic" ? "/rest/api/3/search/jql" : "/rest/api/2/search";

export const jiraAuthHeaders = (
  inst: Pick<JiraInstance, "email" | "token">,
  mode: JiraAuthMode,
): HeadersInit => {
  if (mode === "cloud_basic") {
    return {
      Authorization: `Basic ${Buffer.from(`${inst.email}:${inst.token}`).toString("base64")}`,
      Accept: "application/json",
    };
  }
  return {
    Authorization: `Bearer ${inst.token}`,
    Accept: "application/json",
  };
};
