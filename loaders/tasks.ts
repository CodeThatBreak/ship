import "server-only";
/**
 * The tasks workspace page's first-paint boot config — the same service
 * reads the thin `/api/tasks/*` routes wrap (single mapping source), so the
 * server-rendered island boots complete (no boot-fetch flash).
 *
 * Lives outside `app/**` / `components/**` because the Phase 0 lint zone
 * (docs/phase0-baseline.md) restricts `lib/**` imports from those trees even
 * for server-only code; a loader module is the sanctioned importer (same
 * pattern as `loaders/flows.ts`).
 */
import { db } from "../lib/db";
import { settingString } from "../lib/schemas/setting-values";
import { SDLC_TEMPLATE_ID, templateStore } from "../lib/engine/templates/template-store";
import { taskRegistry } from "../lib/engine/tasks/registry";
import type {
  ExecutionMode,
  RepoSummary,
  TaskProviderInfo,
  TemplateOption,
} from "@/types/tasks";

export interface TasksBoot {
  /** registered task providers — the same serialization GET /api/tasks/providers does */
  providers: TaskProviderInfo[];
  repos: RepoSummary[];
  /** settings' build-mode default, normalized to a closed value */
  defaultMode: ExecutionMode;
  /** template picker rows, newest last (the modal lists newest-first on top) */
  templates: TemplateOption[];
  defaultTemplateId: string;
}

/**
 * All tasks-page boot data in one read: providers, repos, settings default
 * mode and the template options with their default pick.
 */
export function loadTasksBoot(): TasksBoot {
  const providers: TaskProviderInfo[] = taskRegistry
    .list()
    .map((p) => ({ kind: p.kind, label: p.label, configured: p.configured() }));

  const repos: RepoSummary[] = db.listRepos().map((r) => ({
    id: r.id,
    name: r.name,
    cloud_url: r.cloud_url,
    local_path: r.local_path,
  }));

  const defaultMode: ExecutionMode =
    db.getSetting("default_execution_mode", settingString, "cloud") === "local"
      ? "local"
      : "cloud";

  const templates: TemplateOption[] = templateStore
    .list()
    .map((t) => ({ id: t.id, name: t.name }))
    .reverse();
  const defaultTemplateId =
    templates.find((t) => t.id === SDLC_TEMPLATE_ID)?.id ??
    templates[0]?.id ??
    SDLC_TEMPLATE_ID;

  return { providers, repos, defaultMode, templates, defaultTemplateId };
}
