/**
 * Task 27 — the dry-run harness registry snapshot (design §7, finding D1).
 * The promoted test fakes (`FakeAgentPort`/`FakeGitHost`) register under the
 * distinct `dry-run` harness key — the registries forbid duplicate kinds, so
 * the simulation ports are selected by the `dry-run` execution mode, never
 * by resolution surgery on the real ports:
 *
 * - `agentPortRegistry.forMode("dry-run")` resolves the fake; the real modes
 *   (cloud/local) never do.
 * - the git-host registry pins the fake under `dry-run`, it claims NO repos
 *   (URL-based `forRepo` can never land on it), and only a mode-carrying
 *   `forRepo(url, "dry-run")` resolves it.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { assignTestDatabase, resetTestDatabase } from "../helpers/testDatabase";

// Must run before any `db` import touches the connection — dynamic imports
// below resolve lazily once DATABASE_URL points at the test database.
assignTestDatabase();

const { agentPortRegistry } = await import("@/lib/engine/ports/agentPort");
const { gitHostRegistry } = await import("@/lib/engine/ports/gitHost");
const { wireGitHostBuiltins } = await import("@/lib/db/wireGitHostBuiltins");
const { HARNESS_KEYS } = await import("@/lib/engine/constants/harnesses");
const { RUN_MODE } = await import("@/constants/execution");
const { FakeAgentPort } = await import("@/lib/engine/ports/agentPort/fakeAgentPort");
const { FakeGitHost } = await import("@/lib/engine/ports/gitHost/fakeGitHost");

beforeAll(async () => {
  await resetTestDatabase();
  // the git-host built-ins wire on Database construction — wire them here
  // explicitly so the snapshot below reads the production registry shape
  wireGitHostBuiltins();
});

const REPO_URL = "https://git.example.com/acme/repo.git";

describe("dry-run harness registry snapshot (task 27 — design §7 D1)", () => {
  it("the git-host registry pins the built-in pair: the real host plus the dry-run simulation host", () => {
    // the snapshot: exactly the real gitlab host and the dry-run simulation
    // host (task 27) — the fake is registered by the wiring, never per-test
    expect(gitHostRegistry.list().map((h) => h.kind)).toEqual(["gitlab", HARNESS_KEYS.DRY_RUN]);
  });

  it("the agent-port registry resolves the `dry-run` mode to the fake port under its own harness key", async () => {
    const port = await agentPortRegistry.forMode(RUN_MODE.DRY_RUN);
    expect(port).toBeInstanceOf(FakeAgentPort);
    expect(port.kind).toBe(HARNESS_KEYS.DRY_RUN);
    expect(port.harness).toBe(HARNESS_KEYS.DRY_RUN);
    expect(port.execMode).toBe(RUN_MODE.DRY_RUN);
  });

  it("the real execution modes never resolve the simulation port", async () => {
    for (const mode of [RUN_MODE.CLOUD, RUN_MODE.LOCAL] as const) {
      const port = await agentPortRegistry.forMode(mode);
      expect(port.kind).not.toBe(HARNESS_KEYS.DRY_RUN);
      expect(port.execMode).toBe(mode);
    }
  });

  it("the git-host registry pins the dry-run host; URL resolution never lands on it, mode resolution does", async () => {
    const host = gitHostRegistry.get(HARNESS_KEYS.DRY_RUN);
    expect(host).toBeInstanceOf(FakeGitHost);
    expect(host.kind).toBe(HARNESS_KEYS.DRY_RUN);
    // the fake claims no repos — a URL-based forRepo can never resolve it
    expect(await host.ownsRepo(REPO_URL)).toBe(false);
    await expect(gitHostRegistry.forRepo(REPO_URL)).rejects.toThrow(/no git host configured/);
    const byMode = await gitHostRegistry.forRepo(REPO_URL, RUN_MODE.DRY_RUN);
    expect(byMode.kind).toBe(HARNESS_KEYS.DRY_RUN);
  });

  it("the registries forbid a second `dry-run` registration (duplicate kinds)", () => {
    expect(() => agentPortRegistry.register(new FakeAgentPort())).toThrow(/duplicate agent port kind/);
    expect(() => gitHostRegistry.register(new FakeGitHost())).toThrow(/duplicate git host kind/);
  });
});
