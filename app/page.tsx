"use client";
import { useEffect, useState, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  RefreshCw,
  Play,
  Frame,
  GitMerge,
  Workflow,
  AlertTriangle,
  Settings as SettingsIcon,
  Cloud,
  FolderGit2,
  ChevronRight,
  BookOpen,
  SquareCheckBig,
  Bug,
  Layers,
  ListTree,
  CornerDownRight,
  ExternalLink,
  CircleDashed,
  Inbox,
  LayoutTemplate,
} from "lucide-react";
import { Alert } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Spinner } from "../components/ui/spinner";
import { cn } from "cn";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

type TaskT = {
  id: string;
  key: string;
  summary: string;
  status: string;
  issueType: string;
  priority: string;
  figmaUrls: string[];
  jiraUrl: string;
  repo_url?: string;
  parent_key?: string | null;
};
type Flow = {
  id: string;
  task_id: string;
  name: string;
  status: string;
  task_key: string;
  task_summary: string;
  mr_url?: string;
  execution_mode?: string;
};
type Repo = {
  id: string;
  name: string;
  cloud_url: string;
  local_path: string | null;
};

// ── color helpers ──────────────────────────────────────────────────────────

type Node = { icon: ReactNode; className: string };
function typeStyle(issueType: string): Node {
  const t = (issueType ?? "").toLowerCase();
  if (t.includes("sub-task") || t.includes("subtask"))
    return {
      icon: <CornerDownRight size={12} />,
      className: "bg-zinc-500/10 text-zinc-400",
    };
  if (t.includes("bug"))
    return {
      icon: <Bug size={12} />,
      className: "bg-rose-500/10 text-rose-400",
    };
  if (t.includes("story"))
    return {
      icon: <BookOpen size={12} />,
      className: "bg-violet-500/10 text-violet-400",
    };
  if (t.includes("epic"))
    return {
      icon: <Layers size={12} />,
      className: "bg-fuchsia-500/10 text-fuchsia-400",
    };
  if (t.includes("task"))
    return {
      icon: <SquareCheckBig size={12} />,
      className: "bg-blue-500/10 text-blue-400",
    };
  return {
    icon: <CircleDashed size={12} />,
    className: "bg-zinc-500/10 text-zinc-400",
  };
}

type Status = { className: string; label: string };
function statusStyle(status: string): Status {
  const s = (status ?? "").toLowerCase();
  if (/done|closed|resolved|complete/.test(s))
    return { className: "bg-emerald-500/10 text-emerald-400", label: "done" };
  if (/progress|review|testing/.test(s))
    return { className: "bg-blue-500/10 text-blue-400", label: "active" };
  if (/block|hold/.test(s))
    return { className: "bg-rose-500/10 text-rose-400", label: "blocked" };
  return { className: "bg-zinc-500/10 text-zinc-400", label: "todo" };
}

function priorityStyle(priority: string): string {
  const p = (priority ?? "").toLowerCase();
  if (/highest|high|critical|urgent/.test(p))
    return "bg-rose-500/10 text-rose-400";
  if (/medium|moderate/.test(p)) return "bg-amber-500/10 text-amber-400";
  return "bg-zinc-500/10 text-zinc-400";
}

// ── reusable bits ──────────────────────────────────────────────────────────

function TypeChip({
  task,
  className,
}: {
  task: TaskT;
  className?: string;
}) {
  const { icon, className: c } = typeStyle(task.issueType);
  return (
    <a
      href={task.jiraUrl}
      target="_blank"
      className={cn(
        "inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-lg px-2 text-[12px] font-medium transition-colors hover:brightness-125",
        c,
        className,
      )}
    >
      {icon}
      <span className="font-mono">{task.key}</span>
      <ExternalLink size={9} className="opacity-50" />
    </a>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { className, label } = statusStyle(status);
  return <Badge className={className}>{status || "—"}</Badge>;
}

/** Repo + execution-mode picks and the build action, for one task. */
function BuildControls({
  repos,
  templates,
  templateId,
  repoId,
  selectedRepo,
  mode,
  defaultMode,
  setRepo,
  setMode,
  setTemplate,
  onBuild,
  compact,
}: {
  repos: Repo[];
  templates: { id: string; name: string }[];
  templateId: string;
  repoId?: string;
  selectedRepo?: Repo;
  mode: string;
  defaultMode: "cloud" | "local";
  setRepo: (id: string) => void;
  setMode: (m: "cloud" | "local") => void;
  setTemplate: (id: string) => void;
  onBuild: () => void;
  compact?: boolean;
}) {
  return (
    <div className="flex gap-2 items-center flex-wrap">
      <select
        value={templateId}
        onChange={(e) => setTemplate(e.target.value)}
        title="Flow template"
        className={cn(
          "bg-card text-foreground border border-border rounded-lg text-[13px] focus:outline-none focus:border-blue-500",
          compact ? "min-w-[150px] px-2.5 py-1.5" : "min-w-[190px] px-3 py-2",
        )}
      >
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <select
        value={repoId ?? ""}
        onChange={(e) => setRepo(e.target.value)}
        className={cn(
          "bg-card text-foreground border border-border rounded-lg text-[13px] focus:outline-none focus:border-blue-500",
          compact ? "min-w-[170px] px-2.5 py-1.5" : "min-w-[220px] px-3 py-2",
        )}
      >
        <option value="">Select repo…</option>
        {repos.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name} — {hostOf(r.cloud_url)}
          </option>
        ))}
      </select>
      <select
        value={mode}
        onChange={(e) => setMode(e.target.value as "cloud" | "local")}
        className={cn(
          "bg-card text-foreground border border-border rounded-lg text-[13px] focus:outline-none focus:border-blue-500",
          compact ? "px-2.5 py-1.5" : "px-3 py-2",
        )}
      >
        <option value="cloud">☁ Cloud agent</option>
        <option value="local" disabled={!selectedRepo?.local_path}>
          💻 Local (SDK){!selectedRepo?.local_path ? " (no local path)" : ""}
        </option>
      </select>
      <Button size={compact ? "sm" : "default"} onClick={onBuild}>
        <Play size={13} /> Build {compact ? "" : "task"}
      </Button>
    </div>
  );
}

export default function Home() {
  const [tasks, setTasks] = useState<TaskT[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [jiraConfigured, setJiraConfigured] = useState(true);
  const [defaultMode, setDefaultMode] = useState<"cloud" | "local">("cloud");
  const [syncing, setSyncing] = useState(false);
  const [repoFor, setRepoFor] = useState<Record<string, string>>({}); // taskId -> repoId
  const [modeFor, setModeFor] = useState<Record<string, "cloud" | "local">>({});
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  const [templateFor, setTemplateFor] = useState<Record<string, string>>({}); // taskId -> templateId
  const [defaultTemplateId, setDefaultTemplateId] = useState("tpl_sdlc_loop");
  const router = useRouter();

  const load = useCallback(async () => {
    const [t, f, r, s, tpl] = await Promise.all([
      fetch("/api/tasks").then((r) => r.json()),
      fetch("/api/flows").then((r) => r.json()),
      fetch("/api/repos").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/templates").then((r) => r.json()).catch(() => null),
    ]);
    setTasks(t.tasks ?? []);
    setJiraConfigured(t.jiraConfigured);
    setFlows(f.flows ?? []);
    const repoList: Repo[] = r.repos ?? [];
    setRepos(repoList);
    setDefaultMode(s.default_execution_mode === "local" ? "local" : "cloud");
    // template picker entries (latest rows first); default = the built-in SDLC loop
    const tplList: { id: string; name: string }[] = tpl?.templates ?? [];
    tplList.reverse();
    setTemplates(tplList);
    if (!tplList.some((x) => x.id === defaultTemplateId) && tplList.length) {
      setDefaultTemplateId(tplList.find((x) => x.id === "tpl_sdlc_loop")?.id ?? tplList[0].id);
    }
    // preselect repo matching each task's stored repo_url
    const sel: Record<string, string> = {};
    for (const task of t.tasks ?? []) {
      const match = repoList.find(
        (rp) =>
          rp.cloud_url.replace(/\.git$/, "") ===
          (task.repo_url ?? "").replace(/\.git$/, ""),
      );
      if (match) sel[task.id] = match.id;
    }
    setRepoFor((prev) => ({ ...sel, ...prev }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    await fetch("/api/tasks", { method: "POST" });
    await load();
    setSyncing(false);
  };

  const startFlow = async (task: TaskT) => {
    const repoId = repoFor[task.id];
    const repo = repos.find((r) => r.id === repoId);
    const executionMode = modeFor[task.id] ?? defaultMode;
    if (!repo) {
      alert(
        "Pick a repo for this task first (register repos on the Settings page).",
      );
      return;
    }
    if (executionMode === "local" && !repo.local_path) {
      alert(
        `"${repo.name}" has no local path — set one on the Settings page or run in cloud mode.`,
      );
      return;
    }
    await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoUrl: repo.cloud_url }),
    });
    const res = await fetch("/api/flows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: task.id,
        repoId: repo.id,
        executionMode,
        templateId: templateFor[task.id] ?? defaultTemplateId,
      }),
    }).then((r) => r.json());
    if (res.id) router.push(`/flows/${res.id}`);
    else if (res.error) alert(res.error);
  };

  // ── group sub-tasks under their parents ─────────────────────────────────
  type Group =
    | { type: "single"; t: TaskT }
    | {
        type: "family";
        parent: TaskT | null;
        parentKey: string | null;
        children: TaskT[];
      };
  const keys = new Set(tasks.map((t) => t.key));

  // sub-tasks whose parent issue isn't synced get grouped by that parent key
  const orphanChildren = new Map<string, TaskT[]>();
  for (const t of tasks) {
    if (t.parent_key && !keys.has(t.parent_key)) {
      const kids = orphanChildren.get(t.parent_key) ?? [];
      kids.push(t);
      orphanChildren.set(t.parent_key, kids);
    }
  }

  const groups: Group[] = [];
  for (const [pk, kids] of orphanChildren) {
    groups.push({
      type: "family",
      parent: null,
      parentKey: pk,
      children: kids,
    });
  }
  for (const t of tasks) {
    if (t.parent_key) continue; // rendered inside its parent's card (or its orphan group)
    groups.push({ type: "single", t });
  }
  const mrsOpen = flows.filter((f) => f.mr_url).length;

  const buildProps = (t: TaskT) => ({
    repos,
    templates,
    templateId: templateFor[t.id] ?? defaultTemplateId,
    repoId: repoFor[t.id],
    defaultMode,
    selectedRepo: repos.find((r) => r.id === repoFor[t.id]),
    mode: modeFor[t.id] ?? defaultMode,
    setRepo: (id: string) => setRepoFor((p) => ({ ...p, [t.id]: id })),
    setMode: (m: "cloud" | "local") => setModeFor((p) => ({ ...p, [t.id]: m })),
    setTemplate: (id: string) => setTemplateFor((p) => ({ ...p, [t.id]: id })),
    onBuild: () => startFlow(t),
  });

  return (
    <main className="max-w-[1000px] mx-auto px-6 py-10">
      {/* ── header ── */}
      <header className="flex items-center gap-3.5 mb-8">
        <div className="size-10 shrink-0 grid place-items-center rounded-2xl bg-gradient-to-br from-[#5b8def] to-[#a78bfa] shadow-lg shadow-indigo-500/25">
          <Workflow size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-semibold m-0 leading-tight">DevFlow</h1>
          <div className="text-muted-foreground text-[12.5px] mt-0.5 flex items-center gap-1.5">
            {["Jira", "Plan", "Build", "MR", "CI", "Review"].map((step, i) => (
              <span key={step} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight size={10} className="opacity-40" />}
                {step}
              </span>
            ))}
          </div>
        </div>
        <div className="flex-1" />
        <Button variant="outline" render={<Link href="/templates" />}>
          <LayoutTemplate size={14} /> Templates
        </Button>
        <Button variant="outline" render={<a href="/settings" />}>
          <SettingsIcon size={14} /> Settings
        </Button>
        <Button onClick={sync} disabled={syncing || !jiraConfigured}>
          {syncing ? (
            <>
              <Spinner /> Syncing…
            </>
          ) : (
            <>
              <RefreshCw size={14} /> Sync Jira
            </>
          )}
        </Button>
      </header>

      {!jiraConfigured && (
        <Alert className="bg-amber-500/10 text-amber-400 mb-6">
          <AlertTriangle size={16} />
          <span>
            Jira is not configured. Fill in{" "}
            <code className="font-mono">.env</code> (see{" "}
            <code className="font-mono">.env.example</code>) and restart.
          </span>
        </Alert>
      )}
      {repos.length === 0 && (
        <Alert className="bg-amber-500/10 text-amber-400 mb-6">
          <AlertTriangle size={16} />
          <span>
            No repos registered yet —{" "}
            <a href="/settings" className="underline">
              add your repos on the Settings page
            </a>{" "}
            to start flows.
          </span>
        </Alert>
      )}

      {/* ── stats strip ── */}
      {tasks.length > 0 && (
        <div className="flex gap-2 mb-6 flex-wrap">
          {[
            {
              icon: <ListTree size={12} />,
              label: `${tasks.length} tasks`,
              cls: "",
            },
            {
              icon: <Workflow size={12} />,
              label: `${flows.length} flows`,
              cls: flows.length ? "bg-blue-500/10 text-blue-400" : "",
            },
            {
              icon: <GitMerge size={12} />,
              label: `${mrsOpen} MRs open`,
              cls: mrsOpen ? "bg-violet-500/10 text-violet-400" : "",
            },
            {
              icon: <FolderGit2 size={12} />,
              label: `${repos.length} repos`,
              cls: "",
            },
          ].map((s) => (
            <span
              key={s.label}
              className={cn(
                "inline-flex items-center gap-1.5 h-6 rounded-full px-2.5 text-[11.5px] font-medium bg-muted text-muted-foreground",
                s.cls,
              )}
            >
              {s.icon} {s.label}
            </span>
          ))}
        </div>
      )}

      {/* ── active flows ── */}
      {flows.length > 0 && (
        <section className="mb-9">
          <h2 className="text-[12px] font-medium mb-3 text-muted-foreground uppercase tracking-[1.2px] flex items-center gap-2">
            <Workflow size={13} /> Active flows
          </h2>
          <div className="grid gap-2">
            {flows.map((f) => (
              <a
                key={f.id}
                href={`/flows/${f.id}`}
                className="block rounded-xl transition-colors hover:bg-muted/40"
              >
                <div className="flex gap-3 items-center px-4 py-3 border border-border rounded-xl bg-card text-foreground hover:border-blue-500/40 transition-colors group">
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      f.status === "active"
                        ? "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/60 animate-pulse"
                        : "bg-zinc-600",
                    )}
                  />
                  <span className="font-mono text-[12px] text-blue-400">
                    {f.task_key}
                  </span>
                  <span className="flex-1 font-medium text-[13.5px] truncate">
                    {f.task_summary}
                  </span>
                  {f.execution_mode === "local" ? (
                    <Badge variant="outline">
                      <FolderGit2 size={11} /> local
                    </Badge>
                  ) : (
                    <Badge variant="outline">
                      <Cloud size={11} /> cloud
                    </Badge>
                  )}
                  {f.mr_url && (
                    <Badge className="bg-violet-500/10 text-violet-400">
                      <GitMerge size={11} /> MR open
                    </Badge>
                  )}
                  <StatusBadge status={f.status} />
                  <ChevronRight
                    size={14}
                    className="text-muted-foreground opacity-0 -ml-1.5 group-hover:opacity-100 group-hover:ml-0 transition-all"
                  />
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* ── tasks ── */}
      <section>
        <h2 className="text-[12px] font-medium mb-3 text-muted-foreground uppercase tracking-[1.2px] flex items-center gap-2">
          <ListTree size={13} /> My tasks
          {tasks.length > 0 && (
            <span className="normal-case tracking-normal text-[11px] text-muted-foreground/60">
              {tasks.length}
            </span>
          )}
        </h2>

        {tasks.length === 0 && (
          <Card className="justify-center items-center gap-2 py-10 border-dashed! shadow-none! text-muted-foreground">
            <div className="size-10 grid place-items-center rounded-xl bg-muted">
              <Inbox size={18} />
            </div>
            <div className="text-sm font-medium text-foreground">
              No tasks yet
            </div>
            <div className="text-[12.5px]">
              Click “Sync Jira” to pull in your open work.
            </div>
          </Card>
        )}

        <div className="grid gap-3">
          {groups.map((g) => {
            const t = g.type === "single" ? g.t : g.parent;
            const children = g.type === "family" ? g.children : [];
            if (!t && !children.length) return null;
            return (
              <Card
                key={t?.id ?? `grp_${g.type === "family" ? g.parentKey : ""}`}
                className="p-0 gap-0 shadow-sm! overflow-hidden"
              >
                {/* family header (parent issue, or synthetic header for an unsynced parent) */}
                <div className="px-4 pt-3.5 pb-3">
                  {t ? (
                    <>
                      <div className="flex gap-2.5 items-center flex-wrap">
                        <TypeChip task={t} />
                        {(t.priority || t.issueType) && (
                          <span className="flex gap-1.5 items-center">
                            <Badge variant="outline" className="text-[11px]">
                              {t.issueType}
                            </Badge>
                            {t.priority && (
                              <Badge className={priorityStyle(t.priority)}>
                                {t.priority}
                              </Badge>
                            )}
                          </span>
                        )}
                        <span className="flex-1" />
                        <StatusBadge status={t.status} />
                      </div>
                      <strong className="block mt-2 text-[14px] font-medium leading-snug">
                        {t.summary}
                      </strong>
                      {t.figmaUrls.length > 0 && (
                        <div className="mt-2 flex gap-1.5 flex-wrap">
                          {t.figmaUrls.map((u) => (
                            <a key={u} href={u} target="_blank">
                              <Badge
                                variant="outline"
                                className="text-violet-400 border-violet-500/20 bg-violet-500/5"
                              >
                                <Frame size={11} />{" "}
                                {u
                                  .replace(
                                    /https?:\/\/(www\.)?figma\.com\//,
                                    "",
                                  )
                                  .slice(0, 40)}
                                …
                              </Badge>
                            </a>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex gap-2.5 items-center flex-wrap">
                      <span className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-zinc-500/10 px-2 text-[12px] font-medium text-zinc-400">
                        <Layers size={12} />
                        <span className="font-mono">
                          {g.type === "family" ? g.parentKey : ""}
                        </span>
                      </span>
                      <span className="flex-1 text-[13px] text-muted-foreground italic">
                        Parent not in your task list
                      </span>
                      <span className="text-[12px] text-muted-foreground">
                        {children.length} sub-task{children.length !== 1 && "s"}
                      </span>
                    </div>
                  )}
                </div>

                {/* nested sub-tasks */}
                {children.length > 0 && (
                  <div className="mx-4 mb-2 rounded-lg border border-border/60 bg-muted/40 overflow-hidden">
                    <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 text-[10.5px] font-medium text-muted-foreground uppercase tracking-[0.8px]">
                      <CornerDownRight size={11} /> {children.length} sub-task
                      {children.length !== 1 && "s"}
                    </div>
                    <div className="px-2 pb-2 grid gap-0.5">
                      {children.map((c, i) => (
                        <div key={c.id} className="relative pl-3.5">
                          {/* tree rail */}
                          <span
                            className={cn(
                              "absolute left-2 top-0 bottom-0 w-px bg-border",
                              i === children.length - 1 && "h-3.5 bottom-auto",
                            )}
                          />
                          <span className="absolute left-2 top-3.5 w-2 h-px bg-border" />
                          <div className="rounded-md px-1.5 py-1.5 hover:bg-card/80 transition-colors">
                            <div className="flex gap-2 items-center flex-wrap">
                              <TypeChip
                                task={c}
                                className="h-5 min-w-5 px-1.5 text-[11px]"
                              />
                              <span className="flex-1 min-w-[160px] text-[12.5px] text-foreground/90">
                                {c.summary}
                              </span>
                              {c.priority && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] px-1.5"
                                >
                                  {c.priority}
                                </Badge>
                              )}
                              <StatusBadge status={c.status} />
                            </div>
                            <div className="mt-1.5">
                              <BuildControls {...buildProps(c)} compact />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* parent build controls */}
                {t && (
                  <div className="px-4 py-2.5 border-t border-border flex gap-2 items-center flex-wrap bg-muted/30">
                    <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-[0.6px] mr-0.5">
                      Build
                    </span>
                    <BuildControls {...buildProps(t)} />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </section>
    </main>
  );
}
