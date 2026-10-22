"use client";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft, Cloud, Cpu, Database, FileText, GitBranch, FolderGit2, Globe,
  Pencil, Plus, RefreshCw, Trash2, CheckCircle2, XCircle,
} from "lucide-react";
import { useModels } from "../../components/ModelSelect";
import { Alert } from "../../components/ui/alert";
import { Badge, BadgeDot } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Spinner } from "../../components/ui/spinner";
import { Textarea } from "../../components/ui/textarea";

type Repo = {
  id: string; name: string; cloud_url: string; local_path: string | null;
  default_branch: string; local_path_exists?: boolean;
};
type Instance = { id: string; name: string | null; base_url: string; token: string; token_set: boolean };
type PromptTemplate = {
  label: string; description: string; template: string;
  variables: string[]; mode: string;
};
type Settings = {
  default_execution_mode: string;
  default_model: string;
  resolve_delay_ms: number;
  local_agent: { force: boolean; sandbox: boolean; timeout_ms: number };
  prompt_templates?: Record<string, PromptTemplate>;
  status: { cursorApiKeySet: boolean; cursorCliAvailable: boolean; gitlabConfigured: boolean; jiraConfigured: boolean };
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, r, g] = await Promise.all([
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/repos").then((r) => r.json()),
      fetch("/api/gitlab-instances").then((r) => r.json()),
    ]);
    setSettings(s);
    setRepos(r.repos ?? []);
    setInstances(g.instances ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveSettings = async (patch: any) => {
    await fetch("/api/settings", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    load();
  };

  return (
    <main className="max-w-[1000px] mx-auto px-6 py-8">
      <header className="flex items-center gap-3.5 mb-7">
        <a href="/" className="inline-flex items-center gap-1.5 text-muted hover:text-text-dim">
          <ArrowLeft size={15} /> DevFlow
        </a>
        <span className="text-border">|</span>
        <h1 className="text-2xl m-0">Settings</h1>
      </header>

      {error && (
        <Alert variant="red" className="mb-5">
          <XCircle size={16} /><span className="flex-1">{error}</span>
        </Alert>
      )}

      {settings && <StatusBar settings={settings} />}

      {settings && (
        <ExecutionSection settings={settings} onSave={saveSettings} />
      )}

      {settings?.prompt_templates && (
        <PromptTemplatesSection templates={settings.prompt_templates} onSave={saveSettings} />
      )}

      <ReposSection repos={repos} onChanged={load} onError={setError} />

      <InstancesSection instances={instances} onChanged={load} onError={setError} />
    </main>
  );
}

function StatusBar({ settings }: { settings: Settings }) {
  const items = [
    { ok: settings.status.cursorApiKeySet, label: "Cursor API key (cloud)" },
    { ok: settings.status.cursorCliAvailable, label: "Local runtime (SDK + API key)" },
    { ok: settings.status.gitlabConfigured, label: "GitLab" },
    { ok: settings.status.jiraConfigured, label: "Jira" },
  ];
  return (
    <Card className="flex flex-wrap gap-2.5 items-center px-4 py-3 mb-7">
      <span className="text-[12px] text-muted uppercase tracking-[1px] mr-1">Status</span>
      {items.map((i) => (
        <Badge key={i.label} variant={i.ok ? "green" : "amber"}>
          <BadgeDot />{i.label}
        </Badge>
      ))}
    </Card>
  );
}

function ExecutionSection({ settings, onSave }: { settings: Settings; onSave: (p: any) => void }) {
  const la = settings.local_agent;
  const mode = settings.default_execution_mode;
  const models = useModels();
  const modelOptions = settings.default_model && !(models?.models ?? []).includes(settings.default_model)
    ? [settings.default_model, ...(models?.models ?? [])]
    : models?.models ?? [];
  return (
    <section className="mb-8">
      <h2 className="text-[13px] mb-3 text-muted uppercase tracking-[1px] flex items-center gap-[7px]">
        <Cpu size={14} /> Agent execution
      </h2>
      <Card className="p-4 grid gap-4">
        <div>
          <div className="text-[13px] font-medium mb-2">Default mode for new flows</div>
          <div className="flex gap-2">
            {(["cloud", "local"] as const).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={mode === m ? "primary" : "default"}
                onClick={() => onSave({ default_execution_mode: m })}
              >
                {m === "cloud" ? <Cloud size={13} /> : <FolderGit2 size={13} />}
                {m === "cloud" ? "Cursor Cloud" : "Local (SDK)"}
              </Button>
            ))}
          </div>
          <p className="text-muted text-[12px] mt-2">
            Cloud: agents run on Cursor infrastructure against the repo&apos;s cloud URL (needs CURSOR_API_KEY).
            Local: agents run in-process via the Cursor SDK on this machine in the repo&apos;s configured local path (Node 22.13+ and CURSOR_API_KEY).
          </p>
        </div>
        <div className="border-t border-border-soft pt-4">
          <div className="text-[13px] font-medium mb-2">Default model</div>
          <div className="flex gap-2 items-center">
            <select
              value={settings.default_model}
              onChange={(e) => onSave({ default_model: e.target.value })}
              className="bg-panel-2 text-text border border-border rounded-[9px] px-3 py-[9px] text-[13px] font-sans transition-colors duration-150 focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-soft max-w-[280px]"
            >
              <option value="">Account default{models?.source === "catalog" ? "" : " (or DEFAULT_MODEL env)"}</option>
              {modelOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            {models?.source === "fallback" && (
              <span className="text-[12px] text-muted">model catalog unavailable — showing built-in list</span>
            )}
          </div>
          <p className="text-muted text-[12px] mt-2">
            Used for every agent run unless a different model is picked when running a node. Overrides the <code className="font-mono">DEFAULT_MODEL</code> env var.
          </p>
        </div>
        <div className="border-t border-border-soft pt-4">
          <div className="text-[13px] font-medium mb-2">Comment resolution</div>
          <div className="flex gap-2 items-center">
            <Input
              type="number"
              min={0}
              step={1}
              className="w-[110px]"
              value={Math.round((settings.resolve_delay_ms ?? 0) / 60000)}
              onChange={(e) => {
                const mins = Number(e.target.value);
                if (Number.isFinite(mins) && mins >= 0) {
                  onSave({ resolve_delay_ms: Math.round(mins * 60000) });
                }
              }}
            />
            <span className="text-[12px] text-muted">minutes of quiet before auto-resolve starts</span>
          </div>
          <p className="text-muted text-[12px] mt-2">
            New MR comments don&apos;t trigger the Resolve node immediately — it waits for the pipeline
            step to pass, then starts only after no new comment has arrived for this long (each new
            comment resets the timer). Set to 0 to resolve as soon as the pipeline is green.
            The <code className="font-mono">RESOLVE_DELAY_MINUTES</code> env var is the fallback when no value is saved here.
          </p>
        </div>
        <div className="border-t border-border-soft pt-4">
          <div className="text-[13px] font-medium mb-2">Local agent options</div>
          <div className="flex flex-wrap gap-2 items-center">
            <Button size="sm" variant={la.force ? "primary" : "default"} onClick={() => onSave({ local_agent: { force: !la.force } })}>
              Auto-approve tools (--force): {la.force ? "on" : "off"}
            </Button>
            <Button size="sm" variant={la.sandbox ? "primary" : "default"} onClick={() => onSave({ local_agent: { sandbox: !la.sandbox } })}>
              Sandbox: {la.sandbox ? "on" : "off"}
            </Button>
            <span className="text-[12px] text-muted ml-1">
              Timeout: {Math.round(la.timeout_ms / 60000)} min
            </span>
          </div>
          {!la.force && (
            <p className="text-amber text-[12px] mt-2">
              Note: local runs are unattended — without --force the agent may stall waiting for tool approval.
            </p>
          )}
        </div>
      </Card>
    </section>
  );
}

function PromptTemplatesSection({ templates, onSave }: { templates: Record<string, PromptTemplate>; onSave: (p: any) => void }) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Sync local edits when templates load/change
  useEffect(() => {
    const init: Record<string, string> = {};
    for (const [k, v] of Object.entries(templates)) init[k] = v.template;
    setEdits(init);
  }, [templates]);

  const save = async () => {
    setSaving(true);
    const payload: Record<string, { template: string }> = {};
    for (const [k, v] of Object.entries(edits)) {
      if (v !== templates[k]?.template) payload[k] = { template: v };
    }
    if (Object.keys(payload).length) {
      await onSave({ prompt_templates: payload });
    }
    setSaving(false);
  };

  const dirty = Object.entries(edits).some(([k, v]) => v !== templates[k]?.template);

  return (
    <section className="mb-8">
      <h2 className="text-[13px] mb-3 text-muted uppercase tracking-[1px] flex items-center gap-[7px]">
        <FileText size={14} /> Prompt templates
      </h2>
      <p className="text-muted text-[12.5px] mb-3">
        Default prompts sent to each node. Use <code className="font-mono">{"{{variable}}"}</code> placeholders.
        Per-run overrides can be set from the flow screen.
      </p>
      <div className="grid gap-3">
        {Object.entries(templates).map(([key, tpl]) => (
          <Card key={key} className="p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="font-medium text-[13.5px]">{tpl.label}</span>
              <Badge variant="blue">{key}</Badge>
              <Badge>{tpl.mode}</Badge>
            </div>
            <p className="text-muted text-[12px] mb-2">{tpl.description}</p>
            <div className="flex flex-wrap gap-1 mb-2">
              {tpl.variables.map((v) => (
                <Badge key={v} className="font-mono text-[10px]">{`{{${v}}}`}</Badge>
              ))}
            </div>
            <Textarea
              value={edits[key] ?? tpl.template}
              onChange={(e) => setEdits((prev) => ({ ...prev, [key]: e.target.value }))}
              rows={Math.min(12, (edits[key] ?? tpl.template).split("\n").length + 1)}
              className="font-mono text-[12px]"
            />
          </Card>
        ))}
      </div>
      {dirty && (
        <div className="mt-3">
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? <Spinner /> : <CheckCircle2 size={14} />} Save prompt templates
          </Button>
        </div>
      )}
    </section>
  );
}

function ReposSection({ repos, onChanged, onError }: { repos: Repo[]; onChanged: () => void; onError: (e: string | null) => void }) {
  const empty = { name: "", cloud_url: "", local_path: "", default_branch: "main" };
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    onError(null);
    const res = await fetch(editing ? `/api/repos/${editing}` : "/api/repos", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, local_path: form.local_path || null }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      onError(j.error ?? `save failed (${res.status})`);
      return;
    }
    setForm(empty);
    setEditing(null);
    onChanged();
  };

  const del = async (id: string) => {
    await fetch(`/api/repos/${id}`, { method: "DELETE" });
    onChanged();
  };

  return (
    <section className="mb-8">
      <h2 className="text-[13px] mb-3 text-muted uppercase tracking-[1px] flex items-center gap-[7px]">
        <Database size={14} /> Repositories
      </h2>
      <div className="grid gap-2.5 mb-3">
        {repos.map((r) => (
          <Card key={r.id} className="flex items-center gap-2.5 px-4 py-3 flex-wrap">
            <FolderGit2 size={15} className="text-muted shrink-0" />
            <div className="flex-1 min-w-[220px]">
              <div className="font-medium text-[13.5px]">{r.name}</div>
              <div className="text-muted text-[12px] font-mono truncate">{r.cloud_url}</div>
              <div className="text-muted text-[12px] font-mono truncate flex items-center gap-1.5">
                {r.local_path ?? "(no local path — cloud mode only)"}
                {r.local_path && (
                  r.local_path_exists
                    ? <CheckCircle2 size={12} className="text-green" />
                    : <XCircle size={12} className="text-red" />
                )}
              </div>
            </div>
            <Badge><GitBranch size={11} /> {r.default_branch}</Badge>
            {r.local_path && <Badge variant="blue">local-ready</Badge>}
            <Button size="sm" onClick={() => { setEditing(r.id); setForm({ name: r.name, cloud_url: r.cloud_url, local_path: r.local_path ?? "", default_branch: r.default_branch }); }}>
              <Pencil size={12} /> Edit
            </Button>
            <Button size="sm" variant="dangerGhost" onClick={() => del(r.id)}><Trash2 size={12} /></Button>
          </Card>
        ))}
        {repos.length === 0 && <p className="text-muted text-[13px]">No repos registered yet — add one below.</p>}
      </div>

      <Card className="p-4">
        <div className="text-[13px] font-medium mb-3">{editing ? "Edit repo" : "Add repo"}</div>
        <div className="grid gap-2">
          <div className="flex gap-2 flex-wrap">
            <Input placeholder="Name (e.g. payments-api)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="flex-1 min-w-[180px]" />
            <Input placeholder="Default branch" value={form.default_branch} onChange={(e) => setForm({ ...form, default_branch: e.target.value })} className="w-[140px]" />
          </div>
          <Input placeholder="Cloud URL (e.g. https://gitlab.company.com/group/repo)" value={form.cloud_url} onChange={(e) => setForm({ ...form, cloud_url: e.target.value })} />
          <Input placeholder="Local path (e.g. ~/work/repo — required for local mode)" value={form.local_path} onChange={(e) => setForm({ ...form, local_path: e.target.value })} />
          <div className="flex gap-2">
            <Button variant="primary" onClick={submit} disabled={saving || !form.name || !form.cloud_url}>
              {saving ? <Spinner /> : <Plus size={13} />} {editing ? "Save changes" : "Add repo"}
            </Button>
            {editing && <Button onClick={() => { setEditing(null); setForm(empty); }}>Cancel</Button>}
          </div>
        </div>
      </Card>
    </section>
  );
}

function InstancesSection({ instances, onChanged, onError }: { instances: Instance[]; onChanged: () => void; onError: (e: string | null) => void }) {
  const empty = { name: "", base_url: "", token: "" };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; detail: string }>>({});
  const [testing, setTesting] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    onError(null);
    const res = await fetch("/api/gitlab-instances", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      onError(j.error ?? `save failed (${res.status})`);
      return;
    }
    setForm(empty);
    onChanged();
  };

  const del = async (id: string) => {
    await fetch(`/api/gitlab-instances/${id}`, { method: "DELETE" });
    onChanged();
  };

  const test = async (id: string) => {
    setTesting(id);
    const r = await fetch(`/api/gitlab-instances/${id}`, { method: "POST" }).then((r) => r.json());
    setTestResult((prev) => ({ ...prev, [id]: r }));
    setTesting(null);
  };

  return (
    <section className="mb-8">
      <h2 className="text-[13px] mb-3 text-muted uppercase tracking-[1px] flex items-center gap-[7px]">
        <Globe size={14} /> GitLab instances
      </h2>
      <p className="text-muted text-[12.5px] mb-3">
        Add one entry per self-hosted GitLab domain. DevFlow picks the token whose domain matches each repo&apos;s cloud URL.
        If no entry matches, it falls back to <code className="font-mono">GITLAB_BASE_URL</code>/<code className="font-mono">GITLAB_TOKEN</code> from <code className="font-mono">.env</code>.
      </p>
      <div className="grid gap-2.5 mb-3">
        {instances.map((i) => (
          <Card key={i.id} className="flex items-center gap-2.5 px-4 py-3 flex-wrap">
            <Globe size={15} className="text-muted shrink-0" />
            <div className="flex-1 min-w-[220px]">
              <div className="font-medium text-[13.5px]">{i.name || i.base_url}</div>
              <div className="text-muted text-[12px] font-mono">{i.base_url} · token {i.token}</div>
            </div>
            {testResult[i.id] && (
              <Badge variant={testResult[i.id].ok ? "green" : "red"}>
                {testResult[i.id].ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                {testResult[i.id].detail.slice(0, 60)}
              </Badge>
            )}
            <Button size="sm" onClick={() => test(i.id)} disabled={testing === i.id}>
              {testing === i.id ? <Spinner /> : <RefreshCw size={12} />} Test
            </Button>
            <Button size="sm" variant="dangerGhost" onClick={() => del(i.id)}><Trash2 size={12} /></Button>
          </Card>
        ))}
        {instances.length === 0 && <p className="text-muted text-[13px]">No instances registered — using .env for all repos.</p>}
      </div>

      <Card className="p-4">
        <div className="text-[13px] font-medium mb-3">Add GitLab instance</div>
        <div className="grid gap-2">
          <div className="flex gap-2 flex-wrap">
            <Input placeholder="Label (optional, e.g. Corp GitLab)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="flex-1 min-w-[160px]" />
            <Input placeholder="https://gitlab.company.com" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} className="flex-[2] min-w-[220px]" />
          </div>
          <Input placeholder="Personal access token (api scope)" type="password" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
          <div>
            <Button variant="primary" onClick={submit} disabled={saving || !form.base_url || !form.token}>
              {saving ? <Spinner /> : <Plus size={13} />} Add instance
            </Button>
          </div>
        </div>
      </Card>
    </section>
  );
}
