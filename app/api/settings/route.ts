import { NextResponse } from "next/server";
import { db } from "../../../lib/db";
import { agentPortRegistry } from "../../../lib/engine/ports/agent-runner";
import { gitHostRegistry } from "../../../lib/engine/ports/git-host";
import { config } from "../../../lib/config";
import { taskRegistry } from "../../../lib/engine/tasks/registry";
import { normalizeModelSpec } from "../../../lib/modelSpec";
import { cursorApiKeyStored, setCursorApiKey } from "../../../lib/integrations/cursor/credentials";

export const dynamic = "force-dynamic";

/** One mode entry of a harness: the exec mode it runs + probe result. */
export interface SettingsPortMode {
  value: "cloud" | "local";
  label: string;
  configured: boolean;
}

/** One harness group: the ports that share a product surface (e.g. Cursor). */
export interface SettingsHarness {
  key: string;
  label: string;
  modes: SettingsPortMode[];
}

/** The distinct harness surfaces the registered ports belong to. */
function registeredHarnesses(): string[] {
  return [...new Set(agentPortRegistry.list().map((p) => p.harness))];
}

/**
 * Build the settings-page harness groups from the registered ports: one entry
 * per harness key, cloud mode before local, `configured` from a single status
 * probe per port. The harness label is the port label with the exec-mode
 * suffix stripped ("Cursor cloud" → "Cursor").
 */
function harnessGroups(
  statuses: Map<string, { configured: boolean }>,
): SettingsHarness[] {
  const out: SettingsHarness[] = [];
  for (const key of registeredHarnesses()) {
    const ports = agentPortRegistry.list().filter((p) => p.harness === key);
    const modes: SettingsPortMode[] = [];
    for (const mode of ["cloud", "local"] as const) {
      const port = ports.find((p) => p.execMode === mode);
      if (!port) continue;
      modes.push({
        value: mode,
        label: mode === "cloud" ? "Cloud" : "Local (SDK)",
        configured: statuses.get(port.kind)?.configured ?? false,
      });
    }
    out.push({
      key,
      label: ports[0].label.replace(/\s+(cloud|local)$/i, ""),
      modes,
    });
  }
  return out;
}

export async function GET() {
  const ports = agentPortRegistry.list();
  // one probe per port — the harness groups and the Local-runtime status card
  // read the same status map (no duplicate probes)
  const stateList = await Promise.all(
    ports.map((p) => p.status().catch(() => ({ configured: false }))),
  );
  const statuses = new Map(ports.map((p, i) => [p.kind, stateList[i]]));
  return NextResponse.json({
    // harness → mode picker: default_harness selects the product surface,
    // default_execution_mode the mode under it
    default_harness: db.getSetting<string>("default_harness", "cursor"),
    harnesses: harnessGroups(statuses),
    default_execution_mode: db.getSetting<string>("default_execution_mode", "cloud"),
    default_model: normalizeModelSpec(
      db.getSetting<string>("default_model", "") || config.cursor.defaultModel() || "",
    ),
    local_agent: {
      force: db.getSetting<boolean>("local_agent.force", true),
      sandbox: db.getSetting<boolean>("local_agent.sandbox", false),
      timeout_ms: db.getSetting<number>("local_agent.timeout_ms", 30 * 60 * 1000),
    },
    // Phase 3: secrets ({{secrets.NAME}} in http nodes) + the outbound hostname
    // allowlist (empty = deny-by-default). Secret VALUES are never returned —
    // the settings page shows which names are set, writes replace wholesale.
    secrets: Object.keys(db.getSetting<Record<string, unknown>>("secrets", {}) ?? {}),
    http_allowlist: db.getSetting<string[]>("http_allowlist", []),
    status: {
      // DB-stored key only — deleting it from the Harness tab clears the card
      cursorApiKeySet: cursorApiKeyStored(),
      // the generic harness-mode status — the generic shape the settings page
      // reads (new harnesses register in agentPortRegistry and appear there)
      localAgentConfigured: statuses.get(agentPortRegistry.forMode("local").kind)?.configured ?? false,
      // per-registered-host configured status — the generic shape the settings
      // page reads (new hosts register in gitHostRegistry and appear here)
      gitHosts: Object.fromEntries(gitHostRegistry.list().map((h) => [h.kind, h.configured()])),
      // per-registered-task-provider configured status
      taskProviders: Object.fromEntries(taskRegistry.list().map((p) => [p.kind, p.configured()])),
    },
  });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  // Cursor API key (write-only, like the secrets map): a non-empty value
  // replaces the stored key; an empty string deletes it. The value is never
  // returned by GET.
  if (body.cursor_api_key !== undefined) {
    if (typeof body.cursor_api_key !== "string") {
      return NextResponse.json({ error: "cursor_api_key must be a string" }, { status: 400 });
    }
    setCursorApiKey(body.cursor_api_key);
  }
  if (body.default_harness !== undefined) {
    if (typeof body.default_harness !== "string" || !registeredHarnesses().includes(body.default_harness)) {
      return NextResponse.json(
        { error: `default_harness must be one of: ${registeredHarnesses().join(", ")}` },
        { status: 400 },
      );
    }
    db.setSetting("default_harness", body.default_harness);
  }
  if (body.default_execution_mode !== undefined) {
    if (!["cloud", "local"].includes(body.default_execution_mode)) {
      return NextResponse.json({ error: "default_execution_mode must be cloud|local" }, { status: 400 });
    }
    db.setSetting("default_execution_mode", body.default_execution_mode);
  }
  if (body.default_model !== undefined) {
    // the spec is stored as normalized (usable values only): a valueless
    // `composer-2.5[fast]` is swept, `fast=true`/`fast=false` are kept as the
    // meaningful picks — the run path pins fast=false when nothing states one
    db.setSetting("default_model", normalizeModelSpec(String(body.default_model ?? "").trim()));
  }
  if (body.local_agent) {
    const la = body.local_agent;
    if (la.force !== undefined) db.setSetting("local_agent.force", Boolean(la.force));
    if (la.sandbox !== undefined) db.setSetting("local_agent.sandbox", Boolean(la.sandbox));
    if (la.timeout_ms !== undefined) {
      const t = Number(la.timeout_ms);
      if (!Number.isFinite(t) || t < 60000) {
        return NextResponse.json({ error: "timeout_ms must be >= 60000" }, { status: 400 });
      }
      db.setSetting("local_agent.timeout_ms", t);
    }
  }
  if (body.secrets !== undefined) {
    // merge semantics (values are write-only, so wholesale replace would drop
    // everything the client can't see): present keys update, null/"" deletes,
    // absent keys stay untouched
    if (typeof body.secrets !== "object" || body.secrets === null || Array.isArray(body.secrets)) {
      return NextResponse.json({ error: "secrets must be an object {NAME: value}" }, { status: 400 });
    }
    const current = db.getSetting<Record<string, string>>("secrets", {}) ?? {};
    const next: Record<string, string> = { ...current };
    for (const [k, v] of Object.entries(body.secrets as Record<string, unknown>)) {
      const name = k.trim();
      if (!name) continue;
      if (v == null || v === "") {
        delete next[name];
        continue;
      }
      if (typeof v !== "string") {
        return NextResponse.json({ error: `secret "${name}" must be a string` }, { status: 400 });
      }
      next[name] = v;
    }
    db.setSetting("secrets", next);
  }
  if (body.http_allowlist !== undefined) {
    if (!Array.isArray(body.http_allowlist)) {
      return NextResponse.json({ error: "http_allowlist must be an array of hostnames" }, { status: 400 });
    }
    const clean = body.http_allowlist.map((h: unknown) => String(h).trim().toLowerCase()).filter(Boolean);
    db.setSetting("http_allowlist", clean);
  }
  return NextResponse.json({ ok: true });
}
