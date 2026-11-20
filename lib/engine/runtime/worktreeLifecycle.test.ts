import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("worktreeManager process pin (decision Q9)", () => {
  it("is process-pinned via the process-services container under the unchanged key", () => {
    const src = fs.readFileSync(new URL("./worktreeLifecycle.ts", import.meta.url), "utf8");
    expect(src).toMatch(/pinnedProcessService\("worktreeManager"/);
  });

  it("does not pin inside the class file (class files are pure — classFilePurity)", () => {
    const src = fs.readFileSync(
      new URL("./worktreeLifecycle/worktreeManager.ts", import.meta.url),
      "utf8"
    );
    expect(src).not.toMatch(/pinnedProcessService/);
  });
});
