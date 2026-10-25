"use client";
import { useEffect, useState } from "react";
import {
  Cloud, Cpu, Database, FileText, FolderGit2, KeyRound, Plus, RefreshCw,
  CheckCircle2, Trash2,
} from "lucide-react";
import { useModels } from "@/components/ModelSelector";
import type { PricingEntry, PricingRow, Settings } from "@/components/settings/context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

function SectionHeading({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="text-[13px] mb-3 text-muted-foreground uppercase tracking-[1px] flex items-center gap-[7px]">
      {icon} {children}
    </h2>
  );
}

export function StatusBar({ settings }: { settings: Settings }) {
  const items = [
    { ok: settings.status.cursorApiKeySet, label: "Cursor API key (cloud)" },
    { ok: settings.status.cursorCliAvailable, label: "Local runtime (SDK + API key)" },
    { ok: settings.status.gitHosts?.gitlab ?? false, label: "GitLab" },
    { ok: settings.status.taskProviders?.jira ?? false, label: "Jira" },
  ];
  return (
    <Card className="flex flex-wrap gap-2.5 items-center px-4 py-3 mb-8">
      <span className="text-[12px] text-muted-foreground uppercase tracking-[1px] mr-1">Status</span>
      {items.map((i) => (
        <Badge key={i.label} className={i.ok ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}>
          <span className="size-1.5 rounded-full bg-current" />{i.label}
        </Badge>
      ))}
    </Card>
  );
}

export function ExecutionSection({ settings, onSave }: { settings: Settings; onSave: (p: any) => void }) {
  const la = settings.local_agent;
  const mode = settings.default_execution_mode;
  const models = useModels();
  const modelOptions = settings.default_model && !(models?.models ?? []).includes(settings.default_model)
    ? [settings.default_model, ...(models?.models ?? [])]
    : models?.models ?? [];
  return (
    <section className="mb-8">
      <SectionHeading icon={<Cpu size={14} />}>Agent execution</SectionHeading>
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
          <div className="flex gap-2 items-center flex-wrap">
            <Select
              value={settings.default_model || null}
              onValueChange={(v) => onSave({ default_model: v ?? "" })}
            >
              <SelectTrigger className="max-w-[280px]">
                <SelectValue placeholder={`Account default${models?.source === "catalog" ? "" : " (or DEFAULT_MODEL env)"}`} />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <p className="text-warning text-[12px] mt-2">
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

export function PricingSection({ settings, onSave }: { settings: Settings; onSave: (p: any) => void }) {
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
      <SectionHeading icon={<Database size={14} />}>
        Model pricing <span className="normal-case tracking-normal">(USD per million tokens)</span>
      </SectionHeading>
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

export function PromptTemplatesSection({ templates, onSave }: { templates: Record<string, import("@/components/settings/context").PromptTemplate>; onSave: (p: any) => void }) {
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
      <SectionHeading icon={<FileText size={14} />}>Prompt templates</SectionHeading>
      <p className="text-muted-foreground text-[12.5px] mb-3">
        Default prompts sent to each node. Use <code className="font-mono">{"{{variable}}"}</code> placeholders.
        Per-run overrides can be set from the flow screen.
      </p>
      <div className="grid gap-3">
        {Object.entries(templates).map(([key, tpl]) => (
          <Card key={key} className="p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="font-medium text-[13.5px]">{tpl.label}</span>
              <Badge className="bg-info/10 text-info">{key}</Badge>
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
export function CustomNodesSection({ settings, onSave }: { settings: Settings; onSave: (p: any) => void }) {
  const [secretRows, setSecretRows] = useState<{ name: string; value: string }[]>([]);
  const [allowHosts, setAllowHosts] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // values stay blank — set names render as rows so they can be replaced/deleted
    setSecretRows((settings.secrets ?? []).map((name) => ({ name, value: "" })));
    setAllowHosts(settings.http_allowlist ?? []);
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
      http_allowlist: allowHosts.map((h) => h.trim()).filter(Boolean),
    });
    setSaving(false);
  };

  return (
    <section className="mb-8">
      <SectionHeading icon={<KeyRound size={14} />}>Custom nodes</SectionHeading>
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
            value={allowHosts.join("\n")}
            onChange={(e) => setAllowHosts(e.target.value.split("\n"))}
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
