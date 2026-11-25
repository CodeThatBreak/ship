import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "./worktreeSetup";

/**
 * runCommand's environment, separately from worktreeSetup.test.ts (which
 * mocks child_process for its own cases): setup commands must run under the
 * scrubbed server env — the same policy the agent host children run under —
 * so `yarn install` doesn't skip devDependencies under NODE_ENV=production
 * and setup shells don't inherit server secrets.
 */
describe("runCommand env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs the command with NODE_ENV and server secrets scrubbed (PWD as the positive control)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEVFLOW_SECRETS_KEY", "server-key");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-runcommand-env-"));
    try {
      // grep matches only the three vars (`; true` keeps a no-match exit 1 from failing the command)
      await runCommand("env | grep -E '^(NODE_ENV|DEVFLOW_SECRETS_KEY|PWD)=' > probe.txt; true", dir);
      const probe = fs.readFileSync(path.join(dir, "probe.txt"), "utf8");
      expect(probe).toContain(dir); // the scrub didn't nuke the working env (PWD is there)
      expect(probe).not.toContain("production");
      expect(probe).not.toContain("server-key");
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  }, 15_000);
});
