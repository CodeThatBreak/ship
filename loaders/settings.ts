import "server-only";
/**
 * Settings workspace SSR boot — the same reads GET /api/settings and
 * GET /api/repos wrap (single mapping source). Pages prefetch these payloads
 * into TanStack Query instead of waiting on client fetches.
 */
import { agentPortRegistry } from "@/lib/engine/ports/agent-port";
import { gitHostRegistry } from "@/lib/engine/ports/git-host";
import { taskRegistry } from "@/lib/engine/tasks/registry";
import { cursorCredentials } from "@/lib/integrations/cursor/credentials";
import { db } from "@/lib/db";
import { repoService } from "@/lib/repos";
import { SETTINGS_KEYS } from "@/constants/settings";
import { RUN_MODE } from "@/constants/execution";
import { settingsService } from "@/lib/settings";
import {
  settingBoolean,
  settingNumber,
  settingString,
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
    for (const mode of [RUN_MODE.CLOUD, RUN_MODE.LOCAL] as const) {
      const port = ports.find((p) => p.execMode === mode);
      if (!port) continue;
      modes.push({
        value: mode,
        label: mode === RUN_MODE.CLOUD ? "Cloud" : "Local (SDK)",
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
    default_harness: db.getSetting(SETTINGS_KEYS.DEFAULT_HARNESS, settingString, "cursor"),
    harnesses: harnessGroups(statuses),
    default_execution_mode: settingsService.defaultExecutionMode(),
    default_model: settingsService.defaultModel(),
    local_agent: {
      force: db.getSetting(SETTINGS_KEYS.LOCAL_AGENT_FORCE, settingBoolean, true),
      sandbox: db.getSetting(SETTINGS_KEYS.LOCAL_AGENT_SANDBOX, settingBoolean, false),
      timeout_ms: db.getSetting(SETTINGS_KEYS.LOCAL_AGENT_TIMEOUT_MS, settingNumber, 30 * 60 * 1000),
    },
    secrets: Object.keys(db.getSetting(SETTINGS_KEYS.SECRETS, settingUnknownRecord, {})),
    http_allowlist: settingsService.httpAllowlist(),
    status: {
      cursorApiKeySet: cursorCredentials.isStored(),
      localAgentConfigured:
        statuses.get(agentPortRegistry.forMode("local").kind)?.configured ?? false,
      gitHosts: Object.fromEntries(gitHostRegistry.list().map((h) => [h.kind, h.configured()])),
      taskProviders: Object.fromEntries(taskRegistry.list().map((p) => [p.kind, p.configured()])),
    },
  };
};

export type ReposPayload = { repos: Repo[]; serverHome: string };

/** Repo registry — same JSON shape as GET /api/repos. */
export const loadReposPayload = (): ReposPayload => ({
  repos: repoService.listWithPathStatus(),
  serverHome: process.env.HOME ?? "",
});

/** @deprecated Prefer loadReposPayload — returns repos only for legacy callers. */
export const loadRepos = (): Repo[] => loadReposPayload().repos;
