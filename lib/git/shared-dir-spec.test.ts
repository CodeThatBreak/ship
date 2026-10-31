import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeSharedDirSpec, sharedDirPaths } from "./worktree-setup";

describe("shared_dirs path containment", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("rejects traversal and bypassed denylist segments", () => {
    expect(() => normalizeSharedDirSpec("../outside")).toThrow(/inside the worktree/i);
    expect(() => normalizeSharedDirSpec("a/../node_modules")).toThrow(/refusing to symlink node_modules/i);
    expect(() => normalizeSharedDirSpec("./node_modules/lib")).toThrow(/refusing to symlink node_modules/i);
  });

  it("keeps resolved paths inside hub and worktree roots", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-shared-"));
    tmpDirs.push(root);
    const hub = path.join(root, "hub");
    const wt = path.join(root, "wt");
    fs.mkdirSync(path.join(hub, "packages", "shared"), { recursive: true });
    fs.mkdirSync(wt, { recursive: true });

    const { src, dst } = sharedDirPaths(hub, wt, "packages/shared");
    expect(src).toBe(path.resolve(hub, "packages/shared"));
    expect(dst).toBe(path.resolve(wt, "packages/shared"));
  });
});
