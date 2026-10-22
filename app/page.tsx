"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Play, Frame, GitMerge, Ticket, Workflow, AlertTriangle, ExternalLink, Settings as SettingsIcon, Cloud, FolderGit2 } from "lucide-react";
import { Alert } from "../components/ui/alert";
import { Badge, BadgeDot } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Spinner } from "../components/ui/spinner";

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

type TicketT = {
  id: string; key: string; summary: string; status: string; issueType: string;
  priority: string; figmaUrls: string[]; jiraUrl: string; repo_url?: string;
};
type Flow = { id: string; ticket_id: string; name: string; status: string; ticket_key: string; ticket_summary: string; mr_url?: string; execution_mode?: string };
type Repo = { id: string; name: string; cloud_url: string; local_path: string | null };

export default function Home() {
  const [tickets, setTickets] = useState<TicketT[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [jiraConfigured, setJiraConfigured] = useState(true);
  const [defaultMode, setDefaultMode] = useState<"cloud" | "local">("cloud");
  const [syncing, setSyncing] = useState(false);
  const [repoFor, setRepoFor] = useState<Record<string, string>>({}); // ticketId -> repoId
  const [modeFor, setModeFor] = useState<Record<string, "cloud" | "local">>({});
  const router = useRouter();

  const load = useCallback(async () => {
    const [t, f, r, s] = await Promise.all([
      fetch("/api/tickets").then((r) => r.json()),
      fetch("/api/flows").then((r) => r.json()),
      fetch("/api/repos").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
    ]);
    setTickets(t.tickets ?? []);
    setJiraConfigured(t.jiraConfigured);
    setFlows(f.flows ?? []);
    const repoList: Repo[] = r.repos ?? [];
    setRepos(repoList);
    setDefaultMode(s.default_execution_mode === "local" ? "local" : "cloud");
    // preselect repo matching each ticket's stored repo_url
    const sel: Record<string, string> = {};
    for (const ticket of t.tickets ?? []) {
      const match = repoList.find((rp) => rp.cloud_url.replace(/\.git$/, "") === (ticket.repo_url ?? "").replace(/\.git$/, ""));
      if (match) sel[ticket.id] = match.id;
    }
    setRepoFor((prev) => ({ ...sel, ...prev }));
  }, []);

  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setSyncing(true);
    await fetch("/api/tickets", { method: "POST" });
    await load();
    setSyncing(false);
  };

  const startFlow = async (ticket: TicketT) => {
    const repoId = repoFor[ticket.id];
    const repo = repos.find((r) => r.id === repoId);
    const executionMode = modeFor[ticket.id] ?? defaultMode;
    if (!repo) { alert("Pick a repo for this ticket first (register repos on the Settings page)."); return; }
    if (executionMode === "local" && !repo.local_path) {
      alert(`"${repo.name}" has no local path — set one on the Settings page or run in cloud mode.`);
      return;
    }
    await fetch(`/api/tickets/${ticket.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoUrl: repo.cloud_url }),
    });
    const res = await fetch("/api/flows", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId: ticket.id, repoId: repo.id, executionMode }),
    }).then((r) => r.json());
    if (res.id) router.push(`/flows/${res.id}`);
    else if (res.error) alert(res.error);
  };

  return (
    <main className="max-w-[1000px] mx-auto px-6 py-8">
      <header className="flex items-center gap-3.5 mb-7">
        <div>
          <h1 className="text-2xl m-0 bg-gradient-to-br from-[#5b8def] to-[#a78bfa] bg-clip-text text-transparent">DevFlow</h1>
          <div className="text-muted text-[12.5px] mt-0.5">Jira → Plan → Build → MR → CI → Review</div>
        </div>
        <div className="flex-1" />
        <a href="/settings">
          <Button><SettingsIcon size={14} /> Settings</Button>
        </a>
        <Button onClick={sync} disabled={syncing || !jiraConfigured}>
          {syncing ? <><Spinner /> Syncing…</> : <><RefreshCw size={14} /> Sync Jira tickets</>}
        </Button>
      </header>

      {!jiraConfigured && (
        <Alert variant="amber" className="mb-6">
          <AlertTriangle size={16} />
          <span>Jira is not configured. Fill in <code className="font-mono">.env</code> (see <code className="font-mono">.env.example</code>) and restart.</span>
        </Alert>
      )}
      {repos.length === 0 && (
        <Alert variant="amber" className="mb-6">
          <AlertTriangle size={16} />
          <span>No repos registered yet — <a href="/settings" className="underline">add your repos on the Settings page</a> to start flows.</span>
        </Alert>
      )}

      {flows.length > 0 && (
        <section className="mb-8">
          <h2 className="text-[13px] mb-3 text-muted uppercase tracking-[1px] flex items-center gap-[7px]">
            <Workflow size={14} /> Active flows
          </h2>
          <div className="grid gap-2.5">
            {flows.map((f) => (
              <a key={f.id} href={`/flows/${f.id}`}>
                <Card className="flex gap-3 items-center px-4 py-[13px] text-text hover:border-border transition-colors">
                  <Badge variant="blue">{f.ticket_key}</Badge>
                  <span className="flex-1 font-medium">{f.ticket_summary}</span>
                  {f.execution_mode === "local"
                    ? <Badge><FolderGit2 size={11} /> local</Badge>
                    : <Badge><Cloud size={11} /> cloud</Badge>}
                  {f.mr_url && <Badge variant="purple"><GitMerge size={11} /> MR open</Badge>}
                  <Badge variant={f.status === "active" ? "green" : "default"}><BadgeDot />{f.status}</Badge>
                </Card>
              </a>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-[13px] mb-3 text-muted uppercase tracking-[1px] flex items-center gap-[7px]">
          <Ticket size={14} /> My tickets
        </h2>
        {tickets.length === 0 && <p className="text-muted">No tickets yet — click “Sync Jira tickets”.</p>}
        <div className="grid gap-3">
          {tickets.map((t) => {
            const mode = modeFor[t.id] ?? defaultMode;
            const selectedRepo = repos.find((r) => r.id === repoFor[t.id]);
            return (
              <Card key={t.id} className="p-4">
                <div className="flex gap-2.5 items-center flex-wrap">
                  <a href={t.jiraUrl} target="_blank"><Badge variant="blue">{t.key} <ExternalLink size={9} /></Badge></a>
                  <strong className="flex-1 min-w-[200px] text-sm">{t.summary}</strong>
                  <Badge>{t.issueType}</Badge>
                  <Badge variant="amber">{t.status}</Badge>
                  {t.priority && <Badge>{t.priority}</Badge>}
                </div>
                {t.figmaUrls.length > 0 && (
                  <div className="mt-2.5 flex gap-1.5 flex-wrap">
                    {t.figmaUrls.map((u) => (
                      <a key={u} href={u} target="_blank"><Badge variant="purple"><Frame size={11} /> {u.replace(/https?:\/\/(www\.)?figma\.com\//, "").slice(0, 40)}…</Badge></a>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 mt-3 flex-wrap">
                  <select
                    value={repoFor[t.id] ?? ""}
                    onChange={(e) => setRepoFor({ ...repoFor, [t.id]: e.target.value })}
                    className="flex-1 min-w-[220px] bg-panel-2 text-text border border-border rounded-[9px] px-3 py-[9px] text-[13px] focus:outline-none focus:border-accent"
                  >
                    <option value="">Select repo…</option>
                    {repos.map((r) => (
                      <option key={r.id} value={r.id}>{r.name} — {hostOf(r.cloud_url)}</option>
                    ))}
                  </select>
                  <select
                    value={mode}
                    onChange={(e) => setModeFor({ ...modeFor, [t.id]: e.target.value as "cloud" | "local" })}
                    className="bg-panel-2 text-text border border-border rounded-[9px] px-3 py-[9px] text-[13px] focus:outline-none focus:border-accent"
                  >
                    <option value="cloud">☁ Cloud agent</option>
                    <option value="local" disabled={!selectedRepo?.local_path}>
                      💻 Local CLI{!selectedRepo?.local_path ? " (no local path)" : ""}
                    </option>
                  </select>
                  <Button variant="primary" onClick={() => startFlow(t)}><Play size={14} /> Build ticket</Button>
                </div>
              </Card>
            );
          })}
        </div>
      </section>
    </main>
  );
}
