import "server-only";
/**
 * The tasks workspace page's first-paint boot config — the same service
 * reads the thin `/api/tasks/*` routes wrap (single mapping source), so the
 * server-rendered island boots complete (no boot-fetch flash).
 */
import { db } from "../lib/db/app";
import { SDLC_TEMPLATE_ID, templateStore } from "../lib/engine/templates/templateStore";
import { taskRegistry } from "../lib/engine/tasks/registry";
import { settingsService } from "../lib/settings/settingsService";
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

export async function loadTasksBoot(): Promise<TasksBoot> {
  const providers: TaskProviderInfo[] = (await taskRegistry.describe()).map(({ kind, label, configured }) => ({
    kind,
    label,
    configured,
  }));

  const repos: RepoSummary[] = (await db.listRepos()).map((r) => ({
    id: r.id,
    name: r.name,
    cloudUrl: r.cloudUrl,
    localPath: r.localPath,
  }));

  const defaultMode: ExecutionMode = await settingsService.defaultExecutionMode();

  const templates: TemplateOption[] = (await templateStore.list())
    .map((t) => ({ id: t.id, name: t.name }))
    .reverse();
  const defaultTemplateId =
    templates.find((t) => t.id === SDLC_TEMPLATE_ID)?.id ??
    templates[0]?.id ??
    SDLC_TEMPLATE_ID;

  return { providers, repos, defaultMode, templates, defaultTemplateId };
}
