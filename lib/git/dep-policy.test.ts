import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_SYNC_GLOBS,
  depPolicies,
  type RepoDepOverrides,
} from "./dep-policy";

describe("DepPolicyResolver", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-dep-policy-"));
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const pol = (hubPath: string, overrides?: RepoDepOverrides) =>
    depPolicies.resolve({ hubPath, overrides });

  it("returns none when no manifest is recognized", () => {
    const empty = path.join(tmp, "empty");
    fs.mkdirSync(empty, { recursive: true });
    expect(pol(empty)).toMatchObject({ strategy: "none", source: "no recognized manifest+lockfile" });
  });

  it("prefers npm clone with frozen-install fallback when lockfile exists", () => {
    const npmHub = path.join(tmp, "npm");
    fs.mkdirSync(npmHub, { recursive: true });
    fs.writeFileSync(path.join(npmHub, "package.json"), "{}");
    fs.writeFileSync(path.join(npmHub, "package-lock.json"), "{}");
    expect(pol(npmHub)).toMatchObject({
      strategy: "clone",
      lockfile: "package-lock.json",
      fallback: { strategy: "install", command: "npm ci" },
    });
  });

  it("honors per-repo overrides", () => {
    const npmHub = path.join(tmp, "npm-override");
    fs.mkdirSync(npmHub, { recursive: true });
    fs.writeFileSync(path.join(npmHub, "package.json"), "{}");
    fs.writeFileSync(path.join(npmHub, "package-lock.json"), "{}");
    expect(pol(npmHub, { skip_install: true }).source).toBe("override:skip_install");
    expect(pol(npmHub, { install_command: " pnpm install " })).toMatchObject({
      strategy: "command",
      command: "pnpm install",
    });
  });

  it("expands sync globs without descending into .git or node_modules", () => {
    const globHub = path.join(tmp, "globs");
    fs.mkdirSync(path.join(globHub, ".git"), { recursive: true });
    fs.mkdirSync(path.join(globHub, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(globHub, ".env.local"), "A=1");
    fs.writeFileSync(path.join(globHub, "app.rc"), "{}");
    fs.writeFileSync(path.join(globHub, ".git", "ignored"), "");
    expect(depPolicies.resolveSyncGlobs()).toEqual(DEFAULT_SYNC_GLOBS);
    expect(depPolicies.expandSyncPaths(globHub, [".env*", "*.rc"]).sort()).toEqual([".env.local", "app.rc"].sort());
  });
});
