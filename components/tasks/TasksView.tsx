"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { Inbox, Play, RefreshCw } from "lucide-react";
import { Alert, AlertAction } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FilterPicker, type FilterDef } from "@/components/shared";
import { cn } from "@/lib/utils";
import type {
  ExecutionMode,
  LiveTask,
  RepoSummary,
  TaskProviderInfo,
  TemplateOption,
} from "@/types/tasks";
import { STATUS_VALUES, TEXT_DEBOUNCE_MS } from "./constants";
import { useLiveTasks } from "./hooks/use-live-tasks";
import { BuildModal } from "./BuildModal";
import { TasksTable } from "./TasksTable";

export type TasksViewProps = {
  /** registered task providers (server-read) — the Provider filter chips */
  providers: TaskProviderInfo[];
  /** registered repos (server-read) — BuildModal picker */
  repos: RepoSummary[];
  /** settings default for the execution mode select */
  defaultMode: ExecutionMode;
  /** flow templates (server-read) — BuildModal picker */
  templates: TemplateOption[];
  /** settings default template (the SDLC loop) */
  defaultTemplateId: string;
};

/**
 * The tasks island (client): filter-driven live feed + sub-task tree table +
 * the build modal. Boot config (providers, repos, templates, defaults) is
 * passed down from the server page; the feed itself polls the API route.
 */
export function TasksView({
  providers,
  repos,
  defaultMode,
  templates,
  defaultTemplateId,
}: TasksViewProps) {
  // ── filters (drive the feed fetch; provider omitted = default provider) ─
  const [filters, setFilters] = useState<Record<string, string>>({
    assignee: "me",
  });
  const [textInput, setTextInput] = useState("");
  const [text, setText] = useState("");
  const [buildTarget, setBuildTarget] = useState<LiveTask | null>(null);

  const { tasks, payload, pending, refetching, refreshing, staleError, refreshError, forceRefresh } =
    useLiveTasks(filters, text);

  // debounced text filter
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTextInput = (value: string) => {
    setTextInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setText(value), TEXT_DEBOUNCE_MS);
  };

  const filterDefs = useMemo<FilterDef[]>(
    () => [
      {
        key: "provider",
        label: "Provider",
        values: providers.map((p) => ({ value: p.kind, label: p.label })),
      },
      {
        key: "assignee",
        label: "Assignee",
        values: [
          { value: "me", label: "Me" },
          { value: "any", label: "Anyone" },
        ],
      },
      { key: "statusCategory", label: "Status", values: STATUS_VALUES },
    ],
    [providers],
  );

  // sub-task hierarchy: group tasks under their parent when the parent is in
  // the current result set; orphans (parent filtered out / not loaded) stay
  // top-level and keep the "↳ PARENT-KEY" hint instead.
  const childrenByParent = useMemo(() => {
    const byKey = new Map(tasks.map((t) => [t.key, t]));
    const children = new Map<string, LiveTask[]>();
    for (const t of tasks) {
      if (t.parentKey && byKey.has(t.parentKey)) {
        const arr = children.get(t.parentKey) ?? [];
        arr.push(t);
        children.set(t.parentKey, arr);
      }
    }
    return children;
  }, [tasks]);

  const openBuild = useCallback((task: LiveTask) => setBuildTarget(task), []);

  // the DataTable renders the first action as an upfront button (tasks have a
  // single action today)
  const getActions = useCallback(
    (t: LiveTask) => [
      { label: "Build", icon: <Play size={13} />, onSelect: () => openBuild(t) },
    ],
    [openBuild],
  );

  const error = staleError ?? refreshError ?? null;
  const refreshingSpinner = refetching || refreshing;

  return (
    <>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <span>{staleError ? `Stale — ${error}` : error}</span>
          <AlertAction>
            <Button variant="outline" size="sm" onClick={forceRefresh}>
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}

      <section>
        <h2 className="text-[12px] font-medium mb-3 text-muted-foreground uppercase tracking-[1.2px] flex items-center gap-2">
          <Inbox size={13} /> My tasks
          {tasks.length > 0 && !pending && (
            <span className="normal-case tracking-normal text-[11px] text-muted-foreground/60">
              {tasks.length}
            </span>
          )}
        </h2>

        <TasksTable
          tasks={tasks}
          loading={pending && tasks.length === 0}
          childrenByParent={childrenByParent}
          getActions={getActions}
          emptyMessage={
            error
              ? `Failed to load tasks: ${error}`
              : text
                ? `No tasks match “${text}”`
                : "No tasks match the current filters"
          }
          toolbar={
            <>
              {/* GitLab-style filter picker: tokens + text + add-filter menu */}
              <FilterPicker
                defs={filterDefs}
                filters={filters}
                onFiltersChange={setFilters}
                text={textInput}
                onTextChange={onTextInput}
              />

              {/* cache indicator + force refresh (icon-only, tooltip explains state) */}
              <Button
                variant="outline"
                size="icon-sm"
                onClick={forceRefresh}
                title={
                  staleError
                    ? "Stale — the last fetch failed; click to retry fresh"
                    : payload?.cached
                      ? `Showing recent results, fetched ${payload.ageSeconds}s ago — click to refresh`
                      : "Force a fresh fetch"
                }
              >
                <RefreshCw size={13} className={cn(refreshingSpinner && "animate-spin")} />
              </Button>
            </>
          }
        />
      </section>

      {buildTarget && (
        <BuildModal
          task={buildTarget}
          repos={repos}
          templates={templates}
          defaultMode={defaultMode}
          defaultTemplateId={defaultTemplateId}
          onClose={() => setBuildTarget(null)}
        />
      )}
    </>
  );
}
