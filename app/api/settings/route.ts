import { NextResponse } from "next/server";
import { db } from "../../../lib/db";
import { localAgent } from "../../../lib/integrations/localAgent";
import { gitLab } from "../../../lib/integrations/gitlab";
import { config } from "../../../lib/config";
import { prompts, PromptLibrary } from "../../../lib/engine/prompts";
import { flowEngine } from "../../../lib/engine/flow";

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
  return NextResponse.json({ ok: true });
}
