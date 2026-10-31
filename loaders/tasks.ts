import "server-only";
/**
 * The tasks workspace page's first-paint boot config — the same service
 * reads the thin `/api/tasks/*` routes wrap (single mapping source), so the
 * server-rendered island boots complete (no boot-fetch flash).
 */
import { db } from "../lib/db";
import { SDLC_TEMPLATE_ID, templateStore } from "../lib/engine/templates/template-store";
import { taskRegistry } from "../lib/engine/tasks/registry";
import { settingsService } from "../lib/settings";
import type {
  ExecutionMode,
  RepoSummary,
  TaskProviderInfo,
  TemplateOption,
} from "@/types/tasks";

export interface TasksBoot {
  providers: TaskProviderInfo[];
  repos: RepoSummary[];
  defaultMode: ExecutionMode;
  templates: TemplateOption[];
  defaultTemplateId: string;
}

export function loadTasksBoot(): TasksBoot {
  const providers: TaskProviderInfo[] = taskRegistry.describe().map(({ kind, label, configured }) => ({
    kind,
    label,
    configured,
  }));

  const repos: RepoSummary[] = db.listRepos().map((r) => ({
    id: r.id,
    name: r.name,
    cloud_url: r.cloud_url,
    local_path: r.local_path,
  }));

  const defaultMode: ExecutionMode = settingsService.defaultExecutionMode();

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
