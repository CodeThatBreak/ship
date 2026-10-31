import { describe, expect, it } from "vitest";
import { queryKeys } from "@/constants/query-keys";
import { errorMessageOf } from "@/hooks/fetch-json";
import { liveTaskParams } from "./use-live-tasks";

describe("liveTaskParams", () => {
  it("serializes assignee, text, and optional filters", () => {
    const params = liveTaskParams(
      { assignee: "any", provider: "jira", statusCategory: "To Do" },
      "search",
    );
    expect(params).toContain("assignee=any");
    expect(params).toContain("text=search");
    expect(params).toContain("kind=jira");
    expect(params).toContain("statusCategory=To+Do");
  });
});

describe("useLiveTasks feed errors (CR-037)", () => {
  it("exposes query failures as a banner message", () => {
    expect(errorMessageOf(new Error("Request failed (502)"))).toBe("Request failed (502)");
  });
});

describe("useLiveTasks force refresh cache (CR-148)", () => {
  it("keys cached refresh payloads by the params snapshot that started the refresh", () => {
    const beforeFilterChange = liveTaskParams({ assignee: "me" }, "");
    const afterFilterChange = liveTaskParams({ assignee: "any" }, "");
    expect(queryKeys.tasks.live(beforeFilterChange)).not.toEqual(
      queryKeys.tasks.live(afterFilterChange),
    );
  });
});
