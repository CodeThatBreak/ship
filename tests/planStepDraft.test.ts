import { describe, expect, it } from "vitest";
import { emptyDraft, toDraft } from "@/components/flows/components/plan/utils/stepDraft";

describe("plan step drafts", () => {
  it("uses the persisted step id as the draft client id", () => {
    expect(
      toDraft({
        id: "step-1",
        title: "T",
        status: "pending",
        flow_id: "f",
        position: 0,
        files: [],
        origin: "user",
      }).clientId,
    ).toBe("step-1");
  });

  it("assigns a unique client id to new empty drafts", () => {
    const a = emptyDraft();
    const b = emptyDraft();
    expect(a.clientId).toBeTruthy();
    expect(a.clientId).not.toBe(b.clientId);
  });
});
