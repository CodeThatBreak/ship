import { NextResponse } from "next/server";
import { db } from "../../../lib/db";
import { localAgent } from "../../../lib/integrations/localAgent";
import { gitLab } from "../../../lib/integrations/gitlab";
import { config } from "../../../lib/config";
import { prompts, PromptLibrary } from "../../../lib/engine/prompts";
import { flowEngine } from "../../../lib/engine/flow";
import { DEFAULT_PRICING, usageTracker } from "../../../lib/engine/nodes/base/usage-tracker";

export const dynamic = "force-dynamic";

export async function GET() {
  const [cli] = await Promise.all([localAgent.cliAvailable()]);
  return NextResponse.json({
    default_execution_mode: db.getSetting<string>("default_execution_mode", "cloud"),
    default_model: db.getSetting<string>("default_model", "") || config.cursor.defaultModel() || "",
    resolve_delay_ms: flowEngine.resolveDelayMs(),
    local_agent: {
      force: db.getSetting<boolean>("local_agent.force", true),
      sandbox: db.getSetting<boolean>("local_agent.sandbox", false),
      timeout_ms: db.getSetting<number>("local_agent.timeout_ms", 30 * 60 * 1000),
    },
    prompt_templates: prompts.allTemplates(),
    pricing: db.getSetting("pricing", {}),
    pricing_suggested: DEFAULT_PRICING,
    // Phase 3: secrets ({{secrets.NAME}} in http nodes) + the outbound hostname
    // allowlist (empty = deny-by-default). Secret VALUES are never returned —
    // the settings page shows which names are set, writes replace wholesale.
    secrets: Object.keys(db.getSetting<Record<string, unknown>>("secrets", {}) ?? {}),
    http_allowlist: db.getSetting<string[]>("http_allowlist", []),
    status: {
      cursorApiKeySet: Boolean(config.cursor.apiKey()),
      cursorCliAvailable: cli,
      gitlabConfigured: gitLab.configured(),
      jiraConfigured: config.jira.configured(),
    },
  });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  if (body.default_execution_mode !== undefined) {
    if (!["cloud", "local"].includes(body.default_execution_mode)) {
      return NextResponse.json({ error: "default_execution_mode must be cloud|local" }, { status: 400 });
    }
    db.setSetting("default_execution_mode", body.default_execution_mode);
  }
  if (body.default_model !== undefined) {
    db.setSetting("default_model", String(body.default_model ?? "").trim());
  }
  if (body.resolve_delay_ms !== undefined) {
    const t = Number(body.resolve_delay_ms);
    if (!Number.isFinite(t) || t < 0) {
      return NextResponse.json({ error: "resolve_delay_ms must be >= 0" }, { status: 400 });
    }
    db.setSetting("resolve.delay_ms", Math.round(t));
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
  if (body.pricing !== undefined) {
    // { [model|family|*]: { input_per_mtok, output_per_mtok, cache_read_per_mtok } } (USD / Mtok)
    if (typeof body.pricing !== "object" || body.pricing === null || Array.isArray(body.pricing)) {
      return NextResponse.json({ error: "pricing must be an object keyed by model id/family" }, { status: 400 });
    }
    const clean: Record<string, { input_per_mtok?: number; output_per_mtok?: number; cache_read_per_mtok?: number }> = {};
    for (const [key, value] of Object.entries(body.pricing as Record<string, any>)) {
      const id = String(key).trim();
      if (!id) continue;
      const entry: Record<string, number> = {};
      for (const field of ["input_per_mtok", "output_per_mtok", "cache_read_per_mtok", "cache_write_per_mtok"]) {
        const n = Number(value?.[field]);
        if (Number.isFinite(n) && n >= 0) entry[field] = n;
      }
      if (Object.keys(entry).length) clean[id] = entry;
    }
    db.setSetting("pricing", clean);
    // rates changed — re-price legacy/estimated rows with the new rate card
    void usageTracker.backfillCosts(true).catch(() => {});
  }
  if (body.prompt_templates) {
    const pt = body.prompt_templates;
    // Validate: only known top-level node keys
    for (const key of Object.keys(pt)) {
      if (!PromptLibrary.TOP_LEVEL_KEYS.includes(key)) {
        return NextResponse.json({ error: `unknown prompt template key: ${key}` }, { status: 400 });
      }
    }
    db.setSetting("prompt_templates", pt);
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
