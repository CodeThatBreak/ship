"use client";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft, Cloud, Cpu, Database, FileText, GitBranch, FolderGit2, Globe,
  KeyRound, Pencil, Plus, RefreshCw, Trash2, CheckCircle2, XCircle,
} from "lucide-react";
import { useModels } from "../../components/ModelSelector";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Spinner } from "../../components/ui/spinner";
import { Textarea } from "../../components/ui/textarea";

type Repo = {
  id: string; name: string; cloud_url: string; local_path: string | null;
  default_branch: string; local_path_exists?: boolean;
  // worktree setup policy (Phase 2 columns, Phase 3 forms)
  install_command?: string | null;
  skip_install?: number;
  sync_paths?: string | null;
  shared_dirs?: string | null;
  setup_command?: string | null;
};
type HostInstanceRow = { id: string; name: string | null; baseUrl: string; tokenMasked: string };
type GitHost = { kind: string; label: string; configured: boolean; instances: HostInstanceRow[] };
type PromptTemplate = {
  label: string; description: string; template: string;
  variables: string[]; mode: string;
};
type Settings = {
  default_execution_mode: string;
  default_model: string;
  resolve_delay_ms: number;
  local_agent: { force: boolean; sandbox: boolean; timeout_ms: number };
  /** "enabled" | "disabled" — per-flow git worktrees for local runs */
  worktree_mode?: string;
  pnpm_virtual_store?: boolean;
  prompt_templates?: Record<string, PromptTemplate>;
  pricing?: Record<string, PricingEntry>;
  pricing_suggested?: Record<string, PricingEntry>;
  /** names of set secrets only (values never leave the server) */
  secrets?: string[];
  http_allowlist?: string[];
  status: { cursorApiKeySet: boolean; cursorCliAvailable: boolean; gitHosts: Record<string, boolean>; taskProviders: Record<string, boolean> };
};
type PricingEntry = { input_per_mtok?: number; output_per_mtok?: number; cache_read_per_mtok?: number; cache_write_per_mtok?: number };
type PricingRow = { key: string; input?: number; output?: number; cacheRead?: number; cacheWrite?: number };

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [hosts, setHosts] = useState<GitHost[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, r, g] = await Promise.all([
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/repos").then((r) => r.json()),
      fetch("/api/git-hosts").then((r) => r.json()),
    ]);
    setSettings(s);
    setRepos(r.repos ?? []);
    setHosts(g.hosts ?? []);
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
        <a href="/" className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-muted-foreground">
          <ArrowLeft size={15} /> DevFlow
        </a>
        <span className="text-border">|</span>
        <h1 className="text-2xl m-0">Settings</h1>
      </header>

      {error && (
        <Alert variant="destructive" className="mb-5">
          <XCircle size={16} /><span className="flex-1">{error}</span>
        </Alert>
      )}

      {settings && <StatusBar settings={settings} />}

      {settings && (
        <ExecutionSection settings={settings} onSave={saveSettings} />
      )}

      {settings && (
        <PricingSection settings={settings} onSave={saveSettings} />
      )}

      {settings?.prompt_templates && (
        <PromptTemplatesSection templates={settings.prompt_templates} onSave={saveSettings} />
      )}

      {settings && (
        <CustomNodesSection settings={settings} onSave={saveSettings} />
      )}

      <ReposSection repos={repos} onChanged={load} onError={setError} />

      {hosts.map((h) => (
        <GitHostsSection key={h.kind} host={h} onChanged={load} onError={setError} />
      ))}
    </main>
  );
}

function StatusBar({ settings }: { settings: Settings }) {
  const items = [
    { ok: settings.status.cursorApiKeySet, label: "Cursor API key (cloud)" },
    { ok: settings.status.cursorCliAvailable, label: "Local runtime (SDK + API key)" },
    { ok: settings.status.gitHosts?.gitlab ?? false, label: "GitLab" },
    { ok: settings.status.taskProviders?.jira ?? false, label: "Jira" },
  ];
  return (
    <Card className="flex flex-wrap gap-2.5 items-center px-4 py-3 mb-7">
      <span className="text-[12px] text-muted-foreground uppercase tracking-[1px] mr-1">Status</span>
      {items.map((i) => (
        <Badge key={i.label} className={i.ok ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}>
          <span className="size-1.5 rounded-full bg-current" />{i.label}
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
      <h2 className="text-[13px] mb-3 text-muted-foreground uppercase tracking-[1px] flex items-center gap-[7px]">
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
                variant={mode === m ? "default" : "outline"}
                onClick={() => onSave({ default_execution_mode: m })}
              >
                {m === "cloud" ? <Cloud size={13} /> : <FolderGit2 size={13} />}
                {m === "cloud" ? "Cursor Cloud" : "Local (SDK)"}
              </Button>
            ))}
          </div>
          <p className="text-muted-foreground text-[12px] mt-2">
            Cloud: agents run on Cursor infrastructure against the repo&apos;s cloud URL (needs CURSOR_API_KEY).
            Local: agents run in-process via the Cursor SDK on this machine in the repo&apos;s configured local path (Node 22.13+ and CURSOR_API_KEY).
          </p>
        </div>
        <div className="border-t border-border pt-4">
          <div className="text-[13px] font-medium mb-2">Default model</div>
          <div className="flex gap-2 items-center">
            <select
              value={settings.default_model}
              onChange={(e) => onSave({ default_model: e.target.value })}
              className="bg-card text-foreground border border-border rounded-[9px] px-3 py-[9px] text-[13px] font-sans transition-colors duration-150 focus:outline-none focus:border-blue-500 focus:ring-[3px] focus:ring-accent-soft max-w-[280px]"
            >
              <option value="">Account default{models?.source === "catalog" ? "" : " (or DEFAULT_MODEL env)"}</option>
              {modelOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            {models?.source === "fallback" && (
              <span className="text-[12px] text-muted-foreground">model catalog unavailable — showing built-in list</span>
            )}
          </div>
          <p className="text-muted-foreground text-[12px] mt-2">
            Used for every agent run unless a different model is picked when running a node. Overrides the <code className="font-mono">DEFAULT_MODEL</code> env var.
          </p>
        </div>
        <div className="border-t border-border pt-4">
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
            <span className="text-[12px] text-muted-foreground">minutes of quiet before auto-resolve starts</span>
          </div>
          <p className="text-muted-foreground text-[12px] mt-2">
            New MR comments don&apos;t trigger the Resolve node immediately — it waits for the pipeline
            step to pass, then starts only after no new comment has arrived for this long (each new
            comment resets the timer). Set to 0 to resolve as soon as the pipeline is green.
            The <code className="font-mono">RESOLVE_DELAY_MINUTES</code> env var is the fallback when no value is saved here.
          </p>
        </div>
        <div className="border-t border-border pt-4">
          <div className="text-[13px] font-medium mb-2">Local agent options</div>
          <div className="flex flex-wrap gap-2 items-center">
            <Button size="sm" variant={la.force ? "default" : "outline"} onClick={() => onSave({ local_agent: { force: !la.force } })}>
              Auto-approve tools (--force): {la.force ? "on" : "off"}
            </Button>
            <Button size="sm" variant={la.sandbox ? "default" : "outline"} onClick={() => onSave({ local_agent: { sandbox: !la.sandbox } })}>
              Sandbox: {la.sandbox ? "on" : "off"}
            </Button>
            <span className="text-[12px] text-muted-foreground ml-1">
              Timeout: {Math.round(la.timeout_ms / 60000)} min
            </span>
          </div>
          {!la.force && (
            <p className="text-amber-400 text-[12px] mt-2">
              Note: local runs are unattended — without --force the agent may stall waiting for tool approval.
            </p>
          )}
        </div>
        <div className="border-t border-border pt-4">
          <div className="text-[13px] font-medium mb-2">Worktree isolation (local mode)</div>
          <div className="flex flex-wrap gap-2 items-center">
            <Button
              size="sm"
              variant={(settings.worktree_mode ?? "enabled") === "disabled" ? "outline" : "default"}
              onClick={() => onSave({ worktree_mode: (settings.worktree_mode ?? "enabled") === "disabled" ? "enabled" : "disabled" })}
            >
              Per-flow worktrees: {(settings.worktree_mode ?? "enabled") === "disabled" ? "off" : "on"}
            </Button>
            <Button
              size="sm"
              variant={settings.pnpm_virtual_store ? "default" : "outline"}
              onClick={() => onSave({ pnpm_virtual_store: !settings.pnpm_virtual_store })}
            >
              pnpm global virtual store: {settings.pnpm_virtual_store ? "on" : "off"}
            </Button>
          </div>
          <p className="text-muted-foreground text-[12px] mt-2">
            Local agents run in an isolated git worktree per flow (under the DevFlow workspace
            dir) instead of your checkout — your working tree is never touched and flows can run
            concurrently. The pnpm store makes worktree installs near-instant for pnpm repos
            (single-user machine only). Per-repo dependency setup is configured on each repo below.
          </p>
        </div>
      </Card>
    </section>
  );
}

function PricingSection({ settings, onSave }: { settings: Settings; onSave: (p: any) => void }) {
  // saved entries + suggested defaults that aren't overridden yet, so the
  // editor always shows the effective table
  const [rows, setRows] = useState<PricingRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const saved = settings.pricing ?? {};
    const suggested = settings.pricing_suggested ?? {};
    setRows(Object.keys({ ...suggested, ...saved }).map((key) => {
      const p = saved[key] ?? suggested[key] ?? {};
      return { key, input: p.input_per_mtok, output: p.output_per_mtok, cacheRead: p.cache_read_per_mtok, cacheWrite: p.cache_write_per_mtok };
    }));
  }, [settings.pricing, settings.pricing_suggested]);

  const update = (i: number, patch: Partial<PricingRow>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRows(rows.filter((_, j) => j !== i));
  const add = () => setRows([...rows, { key: "", ...{ input: undefined, output: undefined, cacheRead: undefined, cacheWrite: undefined } }]);

  const save = async () => {
    setSaving(true);
    const payload: Record<string, PricingEntry> = {};
    for (const r of rows) {
      const key = r.key.trim();
      if (!key) continue;
      const entry: PricingEntry = {};
      if (Number.isFinite(r.input)) entry.input_per_mtok = Number(r.input);
      if (Number.isFinite(r.output)) entry.output_per_mtok = Number(r.output);
      if (Number.isFinite(r.cacheRead)) entry.cache_read_per_mtok = Number(r.cacheRead);
      if (Number.isFinite(r.cacheWrite)) entry.cache_write_per_mtok = Number(r.cacheWrite);
      if (Object.keys(entry).length) payload[key] = entry;
    }
    await onSave({ pricing: payload });
    setSaving(false);
  };

  return (
    <section className="mb-8">
      <h2 className="text-[13px] mb-3 text-muted-foreground uppercase tracking-[1px] flex items-center gap-[7px]">
        <Database size={14} /> Model pricing <span className="normal-case tracking-normal">(USD per million tokens)</span>
      </h2>
      <Card className="p-4 grid gap-3">
        <div className="grid gap-x-3 gap-y-1.5" style={{ gridTemplateColumns: "1fr 120px 120px 120px 120px auto" }}>
          <span className="text-[12px] text-muted-foreground">model id / family prefix</span>
          <span className="text-[12px] text-muted-foreground text-right">input</span>
          <span className="text-[12px] text-muted-foreground text-right">output</span>
          <span className="text-[12px] text-muted-foreground text-right">cache read</span>
          <span className="text-[12px] text-muted-foreground text-right">cache write</span>
          <span />
          {rows.map((r, i) => (
            <div key={i} className="contents">
              <Input
                placeholder='e.g. composer-2.5 or claude (prefix) or *'
                className="font-mono text-[12px]"
                value={r.key}
                onChange={(e) => update(i, { key: e.target.value })}
              />
              {(["input", "output", "cacheRead", "cacheWrite"] as const).map((f) => (
                <Input
                  key={f}
                  type="number"
                  min={0}
                  step="any"
                  placeholder="—"
                  className="text-right"
                  value={r[f] ?? ""}
                  onChange={(e) => update(i, { [f]: e.target.value === "" ? undefined : Number(e.target.value) } as Partial<PricingRow>)}
                />
              ))}
              <Button size="sm" variant="ghost" onClick={() => remove(i)} aria-label="remove row">
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={add}><Plus size={13} /> Add rate</Button>
          <div className="flex-1" />
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Spinner /> : <RefreshCw size={13} />} Save &amp; re-price runs
          </Button>
        </div>
        <p className="text-muted-foreground text-[12px]">
          Costs are our own calculation — token counts × this table, minus the 7% Enterprise
          discount — because the Cursor billing API doesn&apos;t report per-run charges (it is
          account-gated). The model id matches the longest family prefix you set, with{" "}
          <code className="font-mono">*</code> as the fallback. Saving re-estimates every run
          whose cost came from a previous estimate.
        </p>
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
      <h2 className="text-[13px] mb-3 text-muted-foreground uppercase tracking-[1px] flex items-center gap-[7px]">
        <FileText size={14} /> Prompt templates
      </h2>
      <p className="text-muted-foreground text-[12.5px] mb-3">
        Default prompts sent to each node. Use <code className="font-mono">{"{{variable}}"}</code> placeholders.
        Per-run overrides can be set from the flow screen.
      </p>
      <div className="grid gap-3">
        {Object.entries(templates).map(([key, tpl]) => (
          <Card key={key} className="p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="font-medium text-[13.5px]">{tpl.label}</span>
              <Badge className="bg-blue-500/10 text-blue-400">{key}</Badge>
              <Badge>{tpl.mode}</Badge>
            </div>
            <p className="text-muted-foreground text-[12px] mb-2">{tpl.description}</p>
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
          <Button variant="default" onClick={save} disabled={saving}>
            {saving ? <Spinner /> : <CheckCircle2 size={14} />} Save prompt templates
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * Custom-node settings (Phase 3): secrets for `{{secrets.NAME}}` interpolation
 * in http nodes, and the outbound hostname allowlist the SSRF guard enforces
 * (empty = deny-by-default). Secret values are write-only — the API returns
 * names only; saving replaces the map wholesale.
 */
function CustomNodesSection({ settings, onSave }: { settings: Settings; onSave: (p: any) => void }) {
  const [secretRows, setSecretRows] = useState<{ name: string; value: string }[]>([]);
  const [hosts, setHosts] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // values stay blank — set names render as rows so they can be replaced/deleted
    setSecretRows((settings.secrets ?? []).map((name) => ({ name, value: "" })));
    setHosts(settings.http_allowlist ?? []);
  }, [settings.secrets, settings.http_allowlist]);

  const save = async () => {
    setSaving(true);
    const current = new Set(settings.secrets ?? []);
    const secrets: Record<string, string | null> = {};
    const kept = new Set<string>();
    for (const r of secretRows) {
      const name = r.name.trim();
      if (!name) continue;
      kept.add(name);
      if (r.value) secrets[name] = r.value; // new/replaced value
    }
    for (const name of current) {
      if (!kept.has(name)) secrets[name] = null; // row removed → delete
    }
    await onSave({
      secrets,
      http_allowlist: hosts.map((h) => h.trim()).filter(Boolean),
    });
    setSaving(false);
  };

  return (
    <section className="mb-8">
      <h2 className="text-[13px] mb-3 text-muted-foreground uppercase tracking-[1px] flex items-center gap-[7px]">
        <KeyRound size={14} /> Custom nodes
      </h2>
      <Card className="p-4 grid gap-4">
        <div>
          <div className="text-[13px] font-medium mb-2">Secrets</div>
          <div className="grid gap-1.5">
            {secretRows.map((r, i) => (
              <div key={i} className="flex gap-2 items-center">
                <Input
                  placeholder="NAME (e.g. SLACK_WEBHOOK)"
                  className="font-mono text-[12px] w-[260px]"
                  value={r.name}
                  onChange={(e) => setSecretRows(secretRows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                />
                <Input
                  placeholder={(settings.secrets ?? []).includes(r.name) ? "•••• (set — leave blank to keep)" : "value"}
                  type="password"
                  className="font-mono text-[12px] flex-1"
                  value={r.value}
                  onChange={(e) => setSecretRows(secretRows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                />
                <Button size="sm" variant="ghost" onClick={() => setSecretRows(secretRows.filter((_, j) => j !== i))} aria-label="remove secret">
                  <Trash2 size={13} />
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-2">
            <Button size="sm" variant="outline" onClick={() => setSecretRows([...secretRows, { name: "", value: "" }])}>
              <Plus size={13} /> Add secret
            </Button>
          </div>
          <p className="text-muted-foreground text-[12px] mt-2">
            Referenced as <code className="font-mono">{"{{secrets.NAME}}"}</code> in http node URLs / headers / bodies.
            Values resolve at execution time only — they are never written into flow rows, run inputs, or events.
          </p>
        </div>
        <div className="border-t border-border pt-4">
          <div className="text-[13px] font-medium mb-2">HTTP allowlist</div>
          <Textarea
            rows={3}
            placeholder={"hooks.slack.com\napi.github.com"}
            className="font-mono text-[12px]"
            value={hosts.join("\n")}
            onChange={(e) => setHosts(e.target.value.split("\n"))}
          />
          <p className="text-muted-foreground text-[12px] mt-2">
            One hostname per line (subdomains match). Template-authored http nodes may only call these hosts —
            an empty list denies every outbound call. Requests also pass the SSRF guard: no internal networks,
            redirects re-validated per hop.
          </p>
        </div>
        <div>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Spinner /> : <CheckCircle2 size={13} />} Save custom-node settings
          </Button>
        </div>
      </Card>
    </section>
  );
}

function ReposSection({ repos, onChanged, onError }: { repos: Repo[]; onChanged: () => void; onError: (e: string | null) => void }) {
  const empty = {
    name: "", cloud_url: "", local_path: "", default_branch: "main",
    install_command: "", skip_install: false, sync_paths: "", shared_dirs: "", setup_command: "",
  };
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
      <h2 className="text-[13px] mb-3 text-muted-foreground uppercase tracking-[1px] flex items-center gap-[7px]">
        <Database size={14} /> Repositories
      </h2>
      <div className="grid gap-2.5 mb-3">
        {repos.map((r) => (
          <Card key={r.id} className="flex items-center gap-2.5 px-4 py-3 flex-wrap">
            <FolderGit2 size={15} className="text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-[220px]">
              <div className="font-medium text-[13.5px]">{r.name}</div>
              <div className="text-muted-foreground text-[12px] font-mono truncate">{r.cloud_url}</div>
              <div className="text-muted-foreground text-[12px] font-mono truncate flex items-center gap-1.5">
                {r.local_path ?? "(no local path — cloud mode only)"}
                {r.local_path && (
                  r.local_path_exists
                    ? <CheckCircle2 size={12} className="text-emerald-400" />
                    : <XCircle size={12} className="text-rose-400" />
                )}
              </div>
            </div>
            <Badge><GitBranch size={11} /> {r.default_branch}</Badge>
            {r.local_path && <Badge className="bg-blue-500/10 text-blue-400">local-ready</Badge>}
            <Button size="sm" onClick={() => { setEditing(r.id); setForm({
              name: r.name, cloud_url: r.cloud_url, local_path: r.local_path ?? "", default_branch: r.default_branch,
              install_command: r.install_command ?? "", skip_install: Boolean(r.skip_install),
              sync_paths: r.sync_paths ?? "", shared_dirs: r.shared_dirs ?? "", setup_command: r.setup_command ?? "",
            }); }}>
              <Pencil size={12} /> Edit
            </Button>
            <Button size="sm" variant="ghost" className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10" onClick={() => del(r.id)}><Trash2 size={12} /></Button>
          </Card>
        ))}
        {repos.length === 0 && <p className="text-muted-foreground text-[13px]">No repos registered yet — add one below.</p>}
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
          <div className="border-t border-border pt-3 mt-1">
            <div className="text-[13px] font-medium mb-1.5">Worktree setup policy</div>
            <p className="text-muted-foreground text-[12px] mb-2">
              How a flow&apos;s git worktree gets dependencies and untracked config. Leave everything
              empty to let DevFlow auto-detect the ecosystem; explicit fields below win over detection.
            </p>
            <div className="grid gap-2">
              <div className="flex gap-2 items-center flex-wrap">
                <Input
                  placeholder="Install command override (e.g. pnpm install --filter web)"
                  className="font-mono text-[12px] flex-1 min-w-[240px]"
                  value={form.install_command}
                  onChange={(e) => setForm({ ...form, install_command: e.target.value })}
                />
                <Button
                  size="sm"
                  variant={form.skip_install ? "default" : "outline"}
                  onClick={() => setForm({ ...form, skip_install: !form.skip_install })}
                >
                  Skip install: {form.skip_install ? "on" : "off"}
                </Button>
              </div>
              <Input
                placeholder="Setup command (run last in the worktree, e.g. make bootstrap)"
                className="font-mono text-[12px]"
                value={form.setup_command}
                onChange={(e) => setForm({ ...form, setup_command: e.target.value })}
              />
              <div className="flex gap-2 flex-wrap">
                <Input
                  placeholder="Sync paths to copy from the checkout (.env*, *.rc — one glob per line)"
                  className="font-mono text-[12px] flex-1 min-w-[240px]"
                  value={form.sync_paths}
                  onChange={(e) => setForm({ ...form, sync_paths: e.target.value })}
                />
                <Input
                  placeholder="Shared dirs to symlink (caches)"
                  className="font-mono text-[12px] flex-1 min-w-[200px]"
                  value={form.shared_dirs}
                  onChange={(e) => setForm({ ...form, shared_dirs: e.target.value })}
                />
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="default" onClick={submit} disabled={saving || !form.name || !form.cloud_url}>
              {saving ? <Spinner /> : <Plus size={13} />} {editing ? "Save changes" : "Add repo"}
            </Button>
            {editing && <Button onClick={() => { setEditing(null); setForm(empty); }}>Cancel</Button>}
          </div>
        </div>
      </Card>
    </section>
  );
}

function GitHostsSection({ host, onChanged, onError }: { host: GitHost; onChanged: () => void; onError: (e: string | null) => void }) {
  const empty = { name: "", baseUrl: "", token: "" };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; detail: string }>>({});
  const [testing, setTesting] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    onError(null);
    const res = await fetch(`/api/host-instances/${host.kind}`, {
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
    await fetch(`/api/host-instances/${host.kind}/${id}`, { method: "DELETE" });
    onChanged();
  };

  const test = async (id: string) => {
    setTesting(id);
    const r = await fetch(`/api/host-instances/${host.kind}/${id}`, { method: "POST" }).then((r) => r.json());
    setTestResult((prev) => ({ ...prev, [id]: r }));
    setTesting(null);
  };

  return (
    <section className="mb-8" data-host={host.kind}>
      <h2 className="text-[13px] mb-3 text-muted-foreground uppercase tracking-[1px] flex items-center gap-[7px]">
        <Globe size={14} /> {host.label} instances
      </h2>
      <p className="text-muted-foreground text-[12.5px] mb-3">
        Add one entry per self-hosted {host.label} domain. DevFlow picks the token whose domain matches each repo&apos;s cloud URL.
        If no entry matches, it falls back to the {host.label} .env config.
      </p>
      <div className="grid gap-2.5 mb-3">
        {host.instances.map((i) => (
          <Card key={i.id} className="flex items-center gap-2.5 px-4 py-3 flex-wrap">
            <Globe size={15} className="text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-[220px]">
              <div className="font-medium text-[13.5px]">{i.name || i.baseUrl}</div>
              <div className="text-muted-foreground text-[12px] font-mono">{i.baseUrl} · token {i.tokenMasked}</div>
            </div>
            {testResult[i.id] && (
              <Badge variant={testResult[i.id].ok ? undefined : "destructive"} className={testResult[i.id].ok ? "bg-emerald-500/10 text-emerald-400" : undefined}>
                {testResult[i.id].ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                {testResult[i.id].detail.slice(0, 60)}
              </Badge>
            )}
            <Button size="sm" onClick={() => test(i.id)} disabled={testing === i.id}>
              {testing === i.id ? <Spinner /> : <RefreshCw size={12} />} Test
            </Button>
            <Button size="sm" variant="ghost" className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10" onClick={() => del(i.id)}><Trash2 size={12} /></Button>
          </Card>
        ))}
        {host.instances.length === 0 && <p className="text-muted-foreground text-[13px]">No instances registered — using .env for all repos.</p>}
      </div>

      <Card className="p-4">
        <div className="text-[13px] font-medium mb-3">Add {host.label} instance</div>
        <div className="grid gap-2">
          <div className="flex gap-2 flex-wrap">
            <Input placeholder="Label (optional, e.g. Corp GitLab)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="flex-1 min-w-[160px]" />
            <Input placeholder={`https://${host.kind}.company.com`} value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} className="flex-[2] min-w-[220px]" />
          </div>
          <Input placeholder="Personal access token (api scope)" type="password" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
          <div>
            <Button variant="default" onClick={submit} disabled={saving || !form.baseUrl || !form.token}>
              {saving ? <Spinner /> : <Plus size={13} />} Add instance
            </Button>
          </div>
        </div>
      </Card>
    </section>
  );
}
