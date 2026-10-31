import "server-only";
/**
 * Settings workspace SSR boot — the same reads GET /api/settings and
 * GET /api/repos wrap (single mapping source). Pages prefetch these payloads
 * into TanStack Query instead of waiting on client fetches.
 */
import { agentPortRegistry } from "@/lib/engine/ports/agent-port";
import { gitHostRegistry } from "@/lib/engine/ports/git-host";
import { taskRegistry } from "@/lib/engine/tasks/registry";
import { config } from "@/lib/config";
import { cursorApiKeyStored } from "@/lib/integrations/cursor/credentials";
import { db } from "@/lib/db";
import { repoService } from "@/lib/repos";
import { normalizeModelSpec } from "@/lib/modelSpec";
import {
  settingBoolean,
  settingNumber,
  settingString,
  settingStringArray,
  settingUnknownRecord,
} from "@/lib/schemas/setting-values";
import type { Repo, Settings } from "@/components/settings/context";

/** One mode entry of a harness: the exec mode it runs + probe result. */
type SettingsPortMode = {
  value: "cloud" | "local";
  label: string;
  configured: boolean;
};

type SettingsHarness = {
  key: string;
  label: string;
  modes: SettingsPortMode[];
};

const registeredHarnesses = (): string[] =>
  [...new Set(agentPortRegistry.list().map((p) => p.harness))];

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

/** Full settings document — same JSON shape as GET /api/settings. */
export const loadSettings = async (): Promise<Settings> => {
  const ports = agentPortRegistry.list();
  const stateList = await Promise.all(
    ports.map((p) => p.status().catch(() => ({ configured: false }))),
  );
  const statuses = new Map(ports.map((p, i) => [p.kind, stateList[i]]));
  return {
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
      localAgentConfigured:
        statuses.get(agentPortRegistry.forMode("local").kind)?.configured ?? false,
      gitHosts: Object.fromEntries(gitHostRegistry.list().map((h) => [h.kind, h.configured()])),
      taskProviders: Object.fromEntries(taskRegistry.list().map((p) => [p.kind, p.configured()])),
    },
  };
};

/** Repo registry rows — same JSON shape as GET /api/repos → repos. */
export const loadRepos = (): Repo[] => repoService.listWithPathStatus();
