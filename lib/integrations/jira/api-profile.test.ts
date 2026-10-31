import { describe, expect, it } from "vitest";
import { jiraAuthModeForInstance, jiraMyselfPath, jiraSearchPath } from "./api-profile";

describe("jira api-profile", () => {
  it("selects Cloud vs Data Center API paths", () => {
    expect(jiraAuthModeForInstance({ base_url: "https://you.atlassian.net" })).toBe("cloud_basic");
    expect(jiraMyselfPath("cloud_basic")).toBe("/rest/api/3/myself");
    expect(jiraSearchPath("cloud_basic")).toBe("/rest/api/3/search/jql");

    expect(jiraAuthModeForInstance({ base_url: "https://jira.company.com" })).toBe("dc_bearer");
    expect(jiraMyselfPath("dc_bearer")).toBe("/rest/api/2/myself");
    expect(jiraSearchPath("dc_bearer")).toBe("/rest/api/2/search");
  });
});
