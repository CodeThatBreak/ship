import { describe, expect, it } from "vitest";
import { issueTypeStyle, priorityBadgeClass, statusBadgeClass } from "./constants";

describe("task badge styling", () => {
  it("maps issue types to icons and classes", () => {
    expect(issueTypeStyle("Bug").className).toContain("destructive");
    expect(issueTypeStyle("unknown").className).toContain("zinc");
  });

  it("maps status and priority via lookup tables", () => {
    expect(statusBadgeClass("In Progress")).toContain("info");
    expect(priorityBadgeClass("High")).toContain("destructive");
  });
});
