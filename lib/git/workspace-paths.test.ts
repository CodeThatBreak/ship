import path from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspacePaths } from "./workspace-paths";

describe("WorkspacePaths", () => {
  const root = "/tmp/devflow-ws";
  const paths = new WorkspacePaths(root);

  it("namespaces clone and worktree dirs for the same flow id", () => {
    const id = "flw_abc123";
    expect(paths.cloneDir(id)).toBe(path.join(root, "clones", id));
    expect(paths.worktreeDir(id)).toBe(path.join(root, "worktrees", id));
    expect(paths.cloneDir(id)).not.toBe(paths.worktreeDir(id));
  });

  it("places merge arenas under arenas/", () => {
    expect(paths.mergeArenaDir("flw_parent")).toBe(path.join(root, "arenas", "flw_parent"));
  });
});
