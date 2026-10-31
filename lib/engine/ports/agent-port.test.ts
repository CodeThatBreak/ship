/**
 * Agent port selection (lib/engine/ports/agent-port.ts): `forMode` must
 * prefer the configured default harness's port within an exec mode — the
 * engine-side seam that lets a second harness take over a mode via Settings
 * without engine changes — and fall back to the first port registered for
 * the mode (today's single-harness behavior) when there is no preference.
 *
 * Runs against an isolated temp SQLite DB: DATABASE_PATH is read lazily by
 * lib/config.ts, so setting it before the first `db` import isolates the
 * singleton (AGENTS.md §1 — never a real database). The registry under test
 * is constructed with builtins disabled and an injected harness resolver, so
 * the built-in Cursor adapters and the DB setting never participate.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Must run before any `../..` import touches the db connection — dynamic
// imports below execute in statement order after the static ones hoist.
process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-agent-port-")),
  "test.db",
);

const { AgentPortRegistry } = await import("./agent-port");
import type { AgentPort, AgentRunHandle, AgentRunQuery, AgentStreamOutcome } from "./agent-port";

/** Identity-metaphor stub: selection only reads kind/harness/execMode; every
 *  port method throws loudly so a test cannot accidentally drive one. */
function fakePort(kind: string, harness: string, execMode: "cloud" | "local"): AgentPort {
  const fail = (method: string) => () => {
    throw new Error(`${kind}.${method} must not be called in selection tests`);
  };
  return {
    kind,
    label: kind,
    harness,
    execMode,
    fallbackModels: [],
    listDiscount: 0,
    start: fail("start"),
    stream: fail("stream") as (_h: AgentRunHandle) => Promise<AgentStreamOutcome>,
    getRun: fail("getRun") as (_h: AgentRunHandle) => Promise<AgentRunQuery>,
    cancel: fail("cancel"),
    hasActiveRun: fail("hasActiveRun"),
    releaseActiveRun: fail("releaseActiveRun"),
    getUsage: fail("getUsage"),
    inspectSession: fail("inspectSession"),
    listCatalog: fail("listCatalog"),
    status: fail("status") as () => Promise<{ configured: boolean; detail?: string }>,
  };
}

describe("AgentPortRegistry port selection", () => {
  it("falls back to the first registered port for the mode without a harness preference", () => {
    const reg = new AgentPortRegistry(() => null, false);
    const first = fakePort("cursor-cloud", "cursor", "cloud");
    reg.register(first);
    reg.register(fakePort("acme-cloud", "acme", "cloud"));
    expect(reg.forMode("cloud")).toBe(first);
  });

  it("prefers the configured default harness's port within the mode", () => {
    const reg = new AgentPortRegistry(() => "acme", false);
    reg.register(fakePort("cursor-local", "cursor", "local"));
    const acmeLocal = fakePort("acme-local", "acme", "local");
    reg.register(acmeLocal);
    expect(reg.forMode("local")).toBe(acmeLocal);
  });

  it("falls back when the default harness has no port for the mode", () => {
    const reg = new AgentPortRegistry(() => "acme", false);
    reg.register(fakePort("acme-cloud", "acme", "cloud"));
    const firstLocal = fakePort("cursor-local", "cursor", "local");
    reg.register(firstLocal);
    expect(reg.forMode("local")).toBe(firstLocal);
  });

  it("falls back when the default harness is unregistered (stale setting)", () => {
    const reg = new AgentPortRegistry(() => "ghost", false);
    const first = fakePort("cursor-local", "cursor", "local");
    reg.register(first);
    expect(reg.forMode("local")).toBe(first);
  });

  it("throws when no port is registered for the mode", () => {
    const reg = new AgentPortRegistry(() => null, false);
    reg.register(fakePort("cursor-cloud", "cursor", "cloud"));
    expect(() => reg.forMode("local")).toThrow('no agent runner configured for execution mode "local"');
  });

  it("rejects duplicate kinds", () => {
    const reg = new AgentPortRegistry(() => null, false);
    reg.register(fakePort("acme", "acme", "local"));
    expect(() => reg.register(fakePort("acme", "acme", "local"))).toThrow("duplicate agent port kind: acme");
  });
});
