"use client";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Link2, PlugZap, Trash2, XCircle } from "lucide-react";
import { useSettings } from "@/components/settings/context";
import { CursorIcon, GitLabIcon, JiraIcon } from "@/components/settings/integration-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Settings → Integrations tab bodies: Git (git-host instances), Task (task
 * provider instances) and Harness (agent runners). Each tab supports many
 * providers over time — connecting happens in a stepped modal opened from
 * the Connect button next to the tabs; every connected instance renders as
 * its own card with its own test state.
 */

type InstanceRow = { id: string; name: string | null; baseUrl: string; email?: string; tokenMasked: string };
type TestResult = { ok: boolean; detail: string };

// ── persisted test results ──────────────────────────────────────────────────
// The last connection test per instance survives a refresh (localStorage,
// keyed by provider + instance id). Values come from the server test call, so
// tokens are never stored here — only the ok/detail summary.

const TEST_STORE_KEY = "devflow.integration-tests";

type TestStore = Record<string, TestResult>;

function testStoreKey(provider: string, id: string): string {
  return `${provider}:${id}`;
}

function readTestStore(): TestStore {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(TEST_STORE_KEY) ?? "{}") as TestStore;
  } catch {
    return {};
  }
}

function writeTestStore(store: TestStore): void {
  try {
    window.localStorage.setItem(TEST_STORE_KEY, JSON.stringify(store));
  } catch {
    // storage unavailable (private mode, quota) — badges just won't persist
  }
}

function savedTestResult(provider: string, id: string): TestResult | undefined {
  return readTestStore()[testStoreKey(provider, id)];
}

function persistTestResult(provider: string, id: string, result: TestResult): void {
  writeTestStore({ ...readTestStore(), [testStoreKey(provider, id)]: result });
}

function dropTestResult(provider: string, id: string): void {
  const store = readTestStore();
  delete store[testStoreKey(provider, id)];
  writeTestStore(store);
}

/** Shared tab props — the Connect button lives next to the tabs (page-level). */
type TabProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onError: (e: string | null) => void;
};

// ── shared pieces ───────────────────────────────────────────────────────────

function ConnectButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onClick}>
      <Link2 size={13} /> Connect
    </Button>
  );
}

function InstanceCard({
  icon, instance, onTest, onDelete, testing, testResult,
}: {
  icon: React.ReactNode;
  instance: InstanceRow;
  onTest?: () => void;
  onDelete: () => void;
  testing?: boolean;
  testResult?: TestResult;
}) {
  return (
    <Card className="flex-row items-center gap-3 px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-[13.5px] truncate leading-tight">{instance.name || instance.baseUrl}</span>
          {testResult && (testResult.ok ? (
            <Badge className="bg-success/10 text-success shrink-0"><CheckCircle2 size={11} /> connected</Badge>
          ) : (
            <Badge variant="destructive" className="shrink-0"><XCircle size={11} /> failed</Badge>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-1 min-w-0">
          <span className="text-muted-foreground text-[12px] font-mono truncate">{instance.baseUrl}</span>
          {instance.email && (
            <span className="text-muted-foreground text-[12px] truncate">{instance.email}</span>
          )}
          <Badge variant="outline" className="font-mono text-[10.5px] shrink-0">{instance.tokenMasked}</Badge>
        </div>
      </div>
      {testResult && !testResult.ok && (
        <span className="text-destructive text-[11.5px] max-w-[220px] truncate" title={testResult.detail}>
          {testResult.detail}
        </span>
      )}
      <div className="flex items-center gap-0.5 shrink-0">
        {onTest && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Test connection"
                  onClick={onTest}
                  disabled={testing}
                />
              }
            >
              {testing ? <Spinner /> : <PlugZap size={14} className="text-muted-foreground" />}
            </TooltipTrigger>
            <TooltipContent>Test connection</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Remove instance"
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={onDelete}
              />
            }
          >
            <Trash2 size={14} />
          </TooltipTrigger>
          <TooltipContent>Remove instance</TooltipContent>
        </Tooltip>
      </div>
    </Card>
  );
}

function ConnectEmpty({
  icon, title, description, onConnect,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onConnect: () => void;
}) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <ConnectButton onClick={onConnect} />
      </EmptyContent>
    </Empty>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ProviderSelect({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; icon: React.ReactNode }[];
}) {
  return (
    <Select value={value || null} onValueChange={(v) => onChange(v ?? "")}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select provider" />
      </SelectTrigger>
      <SelectContent>
        {options.map((p) => (
          <SelectItem key={p.value} value={p.value}>
            {p.icon} {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function HostingSelect({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <Select value={value || null} onValueChange={(v) => onChange(v ?? "")}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Cloud or self-hosted?" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── Git tab (git hosts — GitLab for now) ────────────────────────────────────

const GIT_HOSTING = [
  { value: "cloud", label: "Cloud (gitlab.com)" },
  { value: "custom", label: "Self-hosted (custom URL)" },
] as const;

export function GitTab({ open, onOpenChange, onError }: TabProps) {
  const { hosts, reload } = useSettings();
  const host = hosts.find((h) => h.kind === "gitlab");
  const [provider, setProvider] = useState("");
  const [hosting, setHosting] = useState("");
  const [form, setForm] = useState({ name: "", baseUrl: "", token: "" });
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, TestResult>>({});
  const [testing, setTesting] = useState<string | null>(null);

  // restore the last test outcome per instance after refresh (client-only to
  // keep SSR markup stable)
  useEffect(() => {
    setTestResult(readTestStore());
  }, []);

  const isCustom = hosting === "custom";
  const instances: InstanceRow[] = host?.instances ?? [];
  const canConnect = provider === "gitlab" && hosting !== "" && (isCustom ? Boolean(form.baseUrl) : true) && Boolean(form.token);

  const close = () => {
    setProvider("");
    setHosting("");
    setForm({ name: "", baseUrl: "", token: "" });
    onOpenChange(false);
  };

  const submit = async () => {
    setSaving(true);
    onError(null);
    const res = await fetch("/api/host-instances/gitlab", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: isCustom ? form.name : null,
        baseUrl: isCustom ? form.baseUrl : "https://gitlab.com",
        token: form.token,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      onError(j.error ?? `save failed (${res.status})`);
      return;
    }
    close();
    void reload();
  };

  const test = async (id: string) => {
    setTesting(id);
    const r = await fetch(`/api/host-instances/gitlab/${id}`, { method: "POST" }).then((r) => r.json());
    setTestResult((prev) => ({ ...prev, [id]: r }));
    persistTestResult("gitlab", id, r);
    setTesting(null);
  };

  const del = async (id: string) => {
    await fetch(`/api/host-instances/gitlab/${id}`, { method: "DELETE" });
    dropTestResult("gitlab", id);
    void reload();
  };

  return (
    <section data-host="gitlab" className="flex flex-1 flex-col">
      {instances.length === 0 ? (
        <ConnectEmpty
          icon={<GitLabIcon />}
          title="No git provider connected"
          description="Connect a GitLab instance — cloud (gitlab.com) or self-hosted — to work with your repos."
          onConnect={() => onOpenChange(true)}
        />
      ) : (
        <div className="grid gap-2.5 content-start">
          {instances.map((i) => (
            <InstanceCard
              key={i.id}
              icon={<GitLabIcon size={16} />}
              instance={i}
              testing={testing === i.id}
              testResult={testResult[i.id]}
              onTest={() => void test(i.id)}
              onDelete={() => void del(i.id)}
            />
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={close}
        title="Connect GitLab"
        className="max-w-[420px]! sm:max-w-[420px]!"
        footer={
          <>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button onClick={submit} disabled={saving || !canConnect}>
              {saving ? <Spinner /> : <Link2 size={13} />} Connect
            </Button>
          </>
        }
      >
        <div className="grid gap-3.5">
          <Field label="Provider">
            <ProviderSelect
              value={provider}
              onChange={(v) => { setProvider(v); setHosting(""); }}
              options={[{ value: "gitlab", label: "GitLab", icon: <GitLabIcon size={14} /> }]}
            />
          </Field>

          {provider === "gitlab" && (
            <Field label="Type">
              <HostingSelect value={hosting} onChange={setHosting} options={GIT_HOSTING} />
            </Field>
          )}

          {provider === "gitlab" && hosting !== "" && (
            <>
              {isCustom && (
                <div className="grid gap-3.5">
                  <Field label="Label">
                    <Input
                      placeholder="e.g. Corp GitLab"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </Field>
                  <Field label="URL">
                    <Input
                      placeholder="https://gitlab.company.com"
                      value={form.baseUrl}
                      onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                    />
                  </Field>
                </div>
              )}
              <Field label="Access token">
                <Input
                  placeholder="Personal access token (api scope)"
                  type="password"
                  value={form.token}
                  onChange={(e) => setForm({ ...form, token: e.target.value })}
                />
              </Field>
            </>
          )}
        </div>
      </Modal>
    </section>
  );
}

// ── Task tab (task providers — Jira for now) ────────────────────────────────

const JIRA_HOSTING = [
  { value: "cloud", label: "Cloud (atlassian.net)" },
  { value: "custom", label: "Self-hosted (Data Center / Server)" },
] as const;

export function TaskTab({ open, onOpenChange, onError }: TabProps) {
  const [instances, setInstances] = useState<InstanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState("");
  const [hosting, setHosting] = useState("");
  const [form, setForm] = useState({ name: "", baseUrl: "", email: "", token: "" });
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, TestResult>>({});
  const [testing, setTesting] = useState<string | null>(null);

  const isCustom = hosting === "custom";
  const canConnect = provider === "jira" && hosting !== "" && Boolean(form.baseUrl) && Boolean(form.email) && Boolean(form.token);

  const load = useCallback(async () => {
    const j = await fetch("/api/task-instances/jira").then((r) => r.json()).catch(() => null);
    setInstances(j?.instances ?? []);
    setLoading(false);
  }, []);

  // the first fetch resolves after mount — hold the empty CTA back until the
  // instance list is known, otherwise it flashes before the cards appear
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setTestResult(readTestStore());
  }, []);

  const close = () => {
    setProvider("");
    setHosting("");
    setForm({ name: "", baseUrl: "", email: "", token: "" });
    onOpenChange(false);
  };

  const submit = async () => {
    setSaving(true);
    onError(null);
    const res = await fetch("/api/task-instances/jira", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: isCustom ? form.name : null,
        baseUrl: form.baseUrl,
        email: form.email,
        token: form.token,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      onError(j.error ?? `save failed (${res.status})`);
      return;
    }
    close();
    void load();
  };

  const test = async (id: string) => {
    setTesting(id);
    const r = await fetch(`/api/task-instances/jira/${id}`, { method: "POST" }).then((r) => r.json());
    setTestResult((prev) => ({ ...prev, [id]: r }));
    persistTestResult("jira", id, r);
    setTesting(null);
  };

  const del = async (id: string) => {
    await fetch(`/api/task-instances/jira/${id}`, { method: "DELETE" });
    dropTestResult("jira", id);
    void load();
  };

  return (
    <section data-host="jira" className="flex flex-1 flex-col">
      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Spinner />
        </div>
      ) : instances.length === 0 ? (
        <ConnectEmpty
          icon={<JiraIcon />}
          title="No task provider connected"
          description="Connect a task provider — Jira for now — to bring in tasks."
          onConnect={() => onOpenChange(true)}
        />
      ) : (
        <div className="grid gap-2.5 content-start">
          {instances.map((i) => (
            <InstanceCard
              key={i.id}
              icon={<JiraIcon size={15} />}
              instance={i}
              testing={testing === i.id}
              testResult={testResult[i.id]}
              onTest={() => void test(i.id)}
              onDelete={() => void del(i.id)}
            />
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={close}
        title="Connect Jira"
        className="max-w-[420px]! sm:max-w-[420px]!"
        footer={
          <>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button onClick={submit} disabled={saving || !canConnect}>
              {saving ? <Spinner /> : <Link2 size={13} />} Connect
            </Button>
          </>
        }
      >
        <div className="grid gap-3.5">
          <Field label="Provider">
            <ProviderSelect
              value={provider}
              onChange={(v) => { setProvider(v); setHosting(""); }}
              options={[{ value: "jira", label: "Jira", icon: <JiraIcon size={14} /> }]}
            />
          </Field>

          {provider === "jira" && (
            <Field label="Type">
              <HostingSelect value={hosting} onChange={setHosting} options={JIRA_HOSTING} />
            </Field>
          )}

          {provider === "jira" && hosting !== "" && (
            <>
              <Field label="URL">
                <Input
                  placeholder={isCustom ? "https://jira.company.com" : "https://your-site.atlassian.net"}
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                />
              </Field>
              {isCustom && (
                <Field label="Label">
                  <Input
                    placeholder="e.g. Corp Jira"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </Field>
              )}
              <Field label="Email">
                <Input
                  placeholder="your Jira login email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
              <Field label="API token">
                <Input
                  placeholder="API token (cloud) or PAT (self-hosted)"
                  type="password"
                  value={form.token}
                  onChange={(e) => setForm({ ...form, token: e.target.value })}
                />
              </Field>
            </>
          )}
        </div>
      </Modal>
    </section>
  );
}

// ── Harness tab (agent runners — Cursor for now) ────────────────────────────

export function HarnessTab({ open, onOpenChange, onError }: TabProps) {
  const { settings, reload } = useSettings();
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const keySet = settings?.status.cursorApiKeySet ?? false;
  const envKey = settings?.status.cursorApiKeyFromEnv ?? false;
  const canConnect = provider === "cursor" && Boolean(apiKey);

  const close = () => {
    setProvider("");
    setApiKey("");
    onOpenChange(false);
  };

  const connect = async () => {
    setSaving(true);
    onError(null);
    const res = await fetch("/api/settings", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cursor_api_key: apiKey }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      onError(j.error ?? `save failed (${res.status})`);
      return;
    }
    close();
    void reload();
  };

  const disconnect = async () => {
    setSaving(true);
    const res = await fetch("/api/settings", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cursor_api_key: "" }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      onError(j.error ?? `remove failed (${res.status})`);
      return;
    }
    void reload();
  };

  return (
    <section data-harness="cursor" className="flex flex-1 flex-col">
      {!keySet ? (
        <>
          <ConnectEmpty
            icon={<CursorIcon />}
            title="No harness connected"
            description="Connect an agent harness — Cursor for now — to run your agents."
            onConnect={() => onOpenChange(true)}
          />
          {envKey && (
            <p className="text-muted-foreground text-[12px] mt-2 mb-0">
              A <span className="font-mono">CURSOR_API_KEY</span> from the environment is active as a fallback.
            </p>
          )}
        </>
      ) : (
        <div className="grid gap-2.5 content-start">
          <InstanceCard
            icon={<CursorIcon size={16} />}
            instance={{ id: "cursor", name: "Cursor", baseUrl: "https://api.cursor.com", tokenMasked: "API key set" }}
            onDelete={() => void disconnect()}
          />
        </div>
      )}

      <Modal
        open={open}
        onClose={close}
        title="Connect Cursor"
        className="max-w-[420px]! sm:max-w-[420px]!"
        footer={
          <>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button onClick={connect} disabled={saving || !canConnect}>
              {saving ? <Spinner /> : <Link2 size={13} />} Connect
            </Button>
          </>
        }
      >
        <div className="grid gap-3.5">
          <Field label="Provider">
            <ProviderSelect
              value={provider}
              onChange={setProvider}
              options={[{ value: "cursor", label: "Cursor", icon: <CursorIcon size={14} /> }]}
            />
          </Field>

          {provider === "cursor" && (
            <Field label="API key">
              <Input
                placeholder="Cursor API key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="font-mono text-[12px]"
              />
              <a
                href="https://cursor.com/dashboard/api"
                target="_blank"
                rel="noreferrer"
                className="text-[12px] text-info hover:underline"
              >
                Create a key at cursor.com/dashboard/api ↗
              </a>
            </Field>
          )}
        </div>
      </Modal>
    </section>
  );
}
