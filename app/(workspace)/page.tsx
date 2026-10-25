"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Play,
  BookOpen,
  SquareCheckBig,
  Bug,
  Layers,
  CornerDownRight,
  ExternalLink,
  CircleDashed,
  Inbox,
  RefreshCw,
  Loader2,
} from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Modal } from "@/components/ui/modal";
import { DataTable } from "@/components/data-table";
import { FilterPicker, type FilterDef } from "@/components/filter-picker";
import { cn } from "cn";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

type LiveTask = {
  type: string;
  id: string;
  key: string;
  summary: string;
  description: string;
  status: string;
  issueType: string;
  priority: string;
  externalUrl: string;
  parentKey: string;
  fields: { prd?: string; figma_urls?: string[] };
};
type TasksMeta = {
  cached: boolean;
  ageSeconds: number;
  ttlSeconds: number;
  stale?: boolean;
};
type Provider = {
  kind: string;
  label: string;
  configured: boolean;
  contextFields: { key: string; label: string; type: string; required?: boolean }[];
};
type Repo = {
  id: string;
  name: string;
  cloud_url: string;
  local_path: string | null;
};

/** Predefined status buckets (workflow-agnostic, mapped to statusCategory). */
const STATUS_VALUES = [
  { value: "To Do", label: "To Do" },
  { value: "In Progress", label: "In Progress" },
  { value: "Done", label: "Done" },
];

// ── color helpers ──────────────────────────────────────────────────────────

function typeStyle(issueType: string): { className: string; Icon: typeof Bug } {
  const t = (issueType ?? "").toLowerCase();
  if (t.includes("sub-task") || t.includes("subtask"))
    return { Icon: CornerDownRight, className: "bg-zinc-500/10 text-zinc-400" };
  if (t.includes("bug"))
    return { Icon: Bug, className: "bg-destructive/10 text-destructive" };
  if (t.includes("story"))
    return { Icon: BookOpen, className: "bg-violet-500/10 text-violet-400" };
  if (t.includes("epic"))
    return { Icon: Layers, className: "bg-fuchsia-500/10 text-fuchsia-400" };
  if (t.includes("task"))
    return { Icon: SquareCheckBig, className: "bg-info/10 text-info" };
  return { Icon: CircleDashed, className: "bg-zinc-500/10 text-zinc-400" };
}

function StatusBadge({ status }: { status: string }) {
  const s = (status ?? "").toLowerCase();
  const className = /done|closed|resolved|complete/.test(s)
    ? "bg-success/10 text-success"
    : /progress|review|testing/.test(s)
      ? "bg-info/10 text-info"
      : /block|hold/.test(s)
        ? "bg-destructive/10 text-destructive"
        : "bg-zinc-500/10 text-zinc-400";
  return <Badge className={className}>{status || "—"}</Badge>;
}

function TypeChip({ task }: { task: LiveTask }) {
  const { Icon, className } = typeStyle(task.issueType);
  return (
    <a
      href={task.externalUrl}
      target="_blank"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-[12px] font-medium transition-colors hover:brightness-125",
        className,
      )}
      title={task.issueType || "issue"}
    >
      <Icon size={12} />
      <span className="font-mono">{task.key}</span>
      <ExternalLink size={9} className="opacity-50" />
    </a>
  );
}

export default function Home() {
  const [tasks, setTasks] = useState<LiveTask[]>([]);
  const [meta, setMeta] = useState<TasksMeta>({ cached: false, ageSeconds: 0, ttlSeconds: 60 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [booted, setBooted] = useState(false); // initial config/repos fetch done
  const [repos, setRepos] = useState<Repo[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [defaultMode, setDefaultMode] = useState<"cloud" | "local">("cloud");
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  const [defaultTemplateId, setDefaultTemplateId] = useState("tpl_sdlc_loop");

  // ── filters (drive the runtime fetch; provider omitted = default provider) ─
  const [filters, setFilters] = useState<Record<string, string>>({
    assignee: "me",
  });
  const [textInput, setTextInput] = useState("");
  const [text, setText] = useState("");

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

  // ── build modal ──────────────────────────────────────────────────────────
  const [buildTarget, setBuildTarget] = useState<LiveTask | null>(null);
  const [repoId, setRepoId] = useState<string>("");
  const [executionMode, setExecutionMode] = useState<"cloud" | "local">("cloud");
  const [templateId, setTemplateId] = useState(defaultTemplateId);
  const [starting, setStarting] = useState(false);
  const router = useRouter();

  const selectedRepo = repos.find((r) => r.id === repoId);

  // ── live task fetch (filters → runtime search, cached server-side) ──────
  const fetchTasks = useCallback(
    async (
      f: { filters: Record<string, string>; text: string },
      fresh = false,
    ) => {
      setLoading(true);
      const params = new URLSearchParams({
        assignee: f.filters.assignee ?? "me",
        text: f.text,
      });
      if (f.filters.statusCategory) params.set("statusCategory", f.filters.statusCategory);
      if (f.filters.provider) params.set("kind", f.filters.provider);
      if (fresh) params.set("fresh", "1");
      try {
        const res = await fetch(`/api/tasks/live?${params}`).then((r) => r.json());
        if (res.error && !res.tasks) {
          setError(res.error);
        } else {
          setError(res.error ?? null);
          setTasks(res.tasks ?? []);
          setMeta({
            cached: Boolean(res.cached),
            ageSeconds: res.ageSeconds ?? 0,
            ttlSeconds: res.ttlSeconds ?? 60,
            stale: res.stale,
          });
        }
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // debounced text filter
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTextInput = (value: string) => {
    setTextInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setText(value), 400);
  };

  useEffect(() => {
    fetchTasks({ filters, text });
  }, [filters, text, fetchTasks]);

  useEffect(() => {
    (async () => {
      const [r, s, tpl, p] = await Promise.all([
        fetch("/api/repos").then((r) => r.json()),
        fetch("/api/settings").then((r) => r.json()),
        fetch("/api/templates").then((r) => r.json()).catch(() => null),
        fetch("/api/tasks/providers").then((r) => r.json()).catch(() => null),
      ]);
      setProviders(p?.providers ?? []);
      setRepos(r.repos ?? []);
      setDefaultMode(s.default_execution_mode === "local" ? "local" : "cloud");
      const tplList: { id: string; name: string }[] = tpl?.templates ?? [];
      tplList.reverse();
      setTemplates(tplList);
      if (tplList.length) {
        const id =
          tplList.find((x) => x.id === "tpl_sdlc_loop")?.id ?? tplList[0].id;
        setDefaultTemplateId(id);
        setTemplateId(id);
      }
      setBooted(true);
    })();
  }, []);

  // ── build modal ──────────────────────────────────────────────────────────
  const openBuild = (task: LiveTask) => {
    setBuildTarget(task);
    setRepoId("");
    setExecutionMode(defaultMode);
    setTemplateId(defaultTemplateId);
  };

  const startFlow = async () => {
    const task = buildTarget;
    const repo = selectedRepo;
    if (!task || !repo) return;
    if (executionMode === "local" && !repo.local_path) {
      alert(
        `"${repo.name}" has no local path — set one on the Settings page or run in cloud mode.`,
      );
      return;
    }
    setStarting(true);
    try {
      // write-through: only the picked task lands in the DB (engine needs the
      // row for FK + context hydration); browsing stays live-only.
      const mat = await fetch("/api/tasks/materialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      }).then((r) => r.json());
      if (!mat.id) {
        alert(mat.error ?? "Failed to start — task could not be stored.");
        return;
      }
      await fetch(`/api/tasks/${mat.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: repo.cloud_url }),
      });
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: mat.id,
          repoId: repo.id,
          executionMode,
          templateId,
        }),
      }).then((r) => r.json());
      if (res.id) router.push(`/flows/${res.id}`);
      else if (res.error) alert(res.error);
    } finally {
      setStarting(false);
    }
  };

  // ── task table columns ────────────────────────────────────────────────────
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

  const columns = useMemo<ColumnDef<LiveTask>[]>(
    () => [
      {
        accessorKey: "key",
        header: "Task",
        cell: ({ row }) => {
          const t = row.original;
          return (
            <div className="flex items-center gap-2.5 min-w-[280px] max-w-[560px]">
              <TypeChip task={t} />
              <div className="min-w-0">
                <span className="block truncate text-[13px] font-medium leading-tight">
                  {t.summary}
                </span>
                {t.parentKey && row.depth === 0 && (
                  <span className="flex items-center gap-0.5 text-[10.5px] text-muted-foreground/70 font-mono">
                    <CornerDownRight size={9} /> {t.parentKey}
                  </span>
                )}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "issueType",
        header: "Type",
        cell: ({ row }) => (
          <Badge variant="outline" className="text-[11px]">
            {row.original.issueType || "—"}
          </Badge>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "priority",
        header: "Priority",
        cell: ({ row }) => {
          const p = (row.original.priority ?? "").toLowerCase();
          const cls = /highest|high|critical|urgent/.test(p)
            ? "bg-destructive/10 text-destructive"
            : /medium|moderate/.test(p)
              ? "bg-warning/10 text-warning"
              : "bg-zinc-500/10 text-zinc-400";
          return (
            <Badge variant="outline" className={cn("text-[11px] border-transparent", cls)}>
              {row.original.priority || "—"}
            </Badge>
          );
        },
      },
      {
        id: "build",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="outline" onClick={() => openBuild(row.original)}>
              <Play size={13} /> Build
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repos, templates, defaultMode, defaultTemplateId],
  );

  const unconfigured = providers.filter((p) => !p.configured);

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

      {/* alerts render only once the config/repos load completes — no
          "not configured / no repos" flash while data is still loading */}
      {booted && unconfigured.map((p) => (
        <Alert key={p.kind} className="bg-warning/10 text-warning mb-6">
          <span>
            {p.label} is not connected —{" "}
            <a href="/settings/integrations" className="underline">
              add an instance in Settings → Integrations
            </a>.
          </span>
        </Alert>
      ))}
      {booted && repos.length === 0 && (
        <Alert className="bg-warning/10 text-warning mb-6">
          <span>
            No repos registered yet —{" "}
            <a href="/settings/repositories" className="underline">
              add your repos
            </a>{" "}
            to start flows.
          </span>
        </Alert>
      )}

      {/* ── task table ── */}
      <section>
        <h2 className="text-[12px] font-medium mb-3 text-muted-foreground uppercase tracking-[1.2px] flex items-center gap-2">
          <Inbox size={13} /> My tasks
          {tasks.length > 0 && !loading && (
            <span className="normal-case tracking-normal text-[11px] text-muted-foreground/60">
              {tasks.length}
            </span>
          )}
        </h2>

        <DataTable
          columns={columns}
          data={tasks}
          loading={loading}
          pageSize={25}
          initialSorting={[{ id: "key", desc: false }]}
          getSubrows={(t) => childrenByParent.get(t.key)}
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
                onClick={() => fetchTasks({ filters, text }, true)}
                title={
                  meta.stale
                    ? "Stale — the last fetch failed; click to retry fresh"
                    : meta.cached
                      ? `Served from cache (${meta.ageSeconds}s old, TTL ${meta.ttlSeconds}s) — click to force a fresh fetch`
                      : "Force a fresh fetch"
                }
              >
                <RefreshCw size={13} className={cn(loading && "animate-spin")} />
              </Button>
            </>
          }
        />
      </section>

      {/* ── build modal ── */}
      <Modal
        open={buildTarget !== null}
        onClose={() => setBuildTarget(null)}
        title="Start build"
        className="sm:max-w-[520px]"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBuildTarget(null)}>
              Cancel
            </Button>
            <Button onClick={startFlow} disabled={!repoId || starting}>
              {starting ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> Starting…
                </>
              ) : (
                <>
                  <Play size={13} /> Start build
                </>
              )}
            </Button>
          </>
        }
      >
        {buildTarget && (
          <div className="flex flex-col gap-4">
            {/* task summary */}
            <div className="flex items-start gap-2.5">
              <TypeChip task={buildTarget} />
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium leading-snug">
                  {buildTarget.summary}
                </div>
                <div className="mt-1 flex gap-1.5 items-center">
                  <StatusBadge status={buildTarget.status} />
                  {buildTarget.priority && (
                    <Badge variant="outline" className="text-[11px]">
                      {buildTarget.priority}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <Separator />

            <div className="flex flex-col gap-1.5">
              <Label>Flow template</Label>
              <Select value={templateId} onValueChange={(v) => v && setTemplateId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select template…" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Repository</Label>
              <Select value={repoId || null} onValueChange={(v) => v && setRepoId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select repo…" />
                </SelectTrigger>
                <SelectContent>
                  {repos.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name} — {hostOf(r.cloud_url)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Execution mode</Label>
              <Select
                value={executionMode}
                onValueChange={(v) => v && setExecutionMode(v as "cloud" | "local")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cloud">
                    Cloud agent
                  </SelectItem>
                  <SelectItem value="local" disabled={!selectedRepo?.local_path}>
                    Local (SDK)
                    {!selectedRepo?.local_path && (
                      <span className="text-warning">(no local path)</span>
                    )}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
