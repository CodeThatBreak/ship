import Link from "next/link";
import { APP_ROUTES } from "@/constants/routes";
import { loadTasksBoot } from "@/loaders/tasks";
import { Alert } from "@/components/ui/alert";
import { TasksView } from "@/components/tasks/TasksView";
import type { TaskProviderInfo } from "@/types/tasks";

export const dynamic = "force-dynamic";

/**
 * Tasks workspace (server): the boot config — providers, repos, templates and
 * the settings defaults — is read via the loader (the services the thin API
 * routes wrap) and handed to the client island, so the "not connected / no
 * repos" alerts and the build form render complete (no boot-fetch flash).
 * The live task feed stays client-side (its filters are page state; see
 * components/tasks).
 */
export default function TasksPage() {
  const { providers, repos, defaultMode, templates, defaultTemplateId } =
    loadTasksBoot();
  const unconfigured = providers.filter((p: TaskProviderInfo) => !p.configured);

  return (
    <div className="pb-4">
      {/* ── header ── */}
      <header className="flex items-end justify-between gap-4 mb-7">
        <div>
          <h1 className="text-lg font-semibold tracking-tight m-0">Tasks</h1>
          <p className="text-[13px] text-muted-foreground mt-1 mb-0">
            Pick a task, choose a repo and template, and kick off a build.
          </p>
        </div>
      </header>

      {unconfigured.map((p) => (
        <Alert key={p.kind} className="bg-warning/10 text-warning mb-6">
          <span>
            {p.label} is not connected —{" "}
            <Link href={APP_ROUTES.SETTINGS_INTEGRATIONS} className="underline">
              add an instance in Settings → Integrations
            </Link>
            .
          </span>
        </Alert>
      ))}
      {repos.length === 0 && (
        <Alert className="bg-warning/10 text-warning mb-6">
          <span>
            No repos registered yet —{" "}
            <Link href={APP_ROUTES.SETTINGS_REPOSITORIES} className="underline">
              add your repos
            </Link>{" "}
            to start flows.
          </span>
        </Alert>
      )}

      <TasksView
        providers={providers}
        repos={repos}
        defaultMode={defaultMode}
        templates={templates}
        defaultTemplateId={defaultTemplateId}
      />
    </div>
  );
}
