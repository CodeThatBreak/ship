import { toErrorResponse } from "@/lib/errors";
import { parseJson } from "@/lib/http/parse";
import { settingsPatchBodySchema } from "@/lib/schemas/settings-patch";
import { settingsService } from "@/lib/settings";
import { NextResponse } from "next/server";
import { agentPortRegistry } from "../../../lib/engine/ports/agent-port";
import { gitHostRegistry } from "../../../lib/engine/ports/git-host";
import { config } from "../../../lib/config";
import { taskRegistry } from "../../../lib/engine/tasks/registry";
import { normalizeModelSpec } from "../../../lib/modelSpec";
import { cursorApiKeyStored } from "../../../lib/integrations/cursor/credentials";
import { db } from "../../../lib/db";
import {
  settingBoolean,
  settingNumber,
  settingString,
  settingStringArray,
  settingUnknownRecord,
} from "../../../lib/schemas/setting-values";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
const registeredHarnesses = (): string[] =>
  [...new Set(agentPortRegistry.list().map((p) => p.harness))];

/**
 * Build the settings-page harness groups from the registered ports: one entry
 * per harness key, cloud mode before local, `configured` from a single status
 * probe per port. The harness label is the port label with the exec-mode
 * suffix stripped ("Cursor cloud" → "Cursor").
 */
const harnessGroups = (
  statuses: Map<string, { configured: boolean }>,
): SettingsHarness[] => {
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
};

export const GET = async () => {
  const ports = agentPortRegistry.list();
  const stateList = await Promise.all(
    ports.map((p) => p.status().catch(() => ({ configured: false }))),
  );
  const statuses = new Map(ports.map((p, i) => [p.kind, stateList[i]]));
  return NextResponse.json({
    default_harness: db.getSetting("default_harness", settingString, "cursor"),
    harnesses: harnessGroups(statuses),
    default_execution_mode: db.getSetting("default_execution_mode", settingString, "cloud"),
    default_model: normalizeModelSpec(
      db.getSetting("default_model", settingString, "") || config.defaultModel() || "",
    ),
    local_agent: {
      force: db.getSetting("local_agent.force", settingBoolean, true),
      sandbox: db.getSetting("local_agent.sandbox", settingBoolean, false),
      timeout_ms: db.getSetting("local_agent.timeout_ms", settingNumber, 30 * 60 * 1000),
    },
    secrets: Object.keys(db.getSetting("secrets", settingUnknownRecord, {})),
    http_allowlist: db.getSetting("http_allowlist", settingStringArray, []),
    status: {
      cursorApiKeySet: cursorApiKeyStored(),
      localAgentConfigured: statuses.get(agentPortRegistry.forMode("local").kind)?.configured ?? false,
      gitHosts: Object.fromEntries(gitHostRegistry.list().map((h) => [h.kind, h.configured()])),
      taskProviders: Object.fromEntries(taskRegistry.list().map((p) => [p.kind, p.configured()])),
    },
  });
};

export const PATCH = async (req: Request) => {
  try {
    const body = await parseJson(req, settingsPatchBodySchema(registeredHarnesses()));
    settingsService.update(body);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};
