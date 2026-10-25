"use client";
import { useState } from "react";
import { CheckCircle2, Globe, Plus, RefreshCw, Trash2, XCircle } from "lucide-react";
import type { GitHost } from "@/components/settings/context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export function GitHostsSection({ host, onChanged, onError }: { host: GitHost; onChanged: () => void; onError: (e: string | null) => void }) {
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
              <Badge variant={testResult[i.id].ok ? undefined : "destructive"} className={testResult[i.id].ok ? "bg-success/10 text-success" : undefined}>
                {testResult[i.id].ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                {testResult[i.id].detail.slice(0, 60)}
              </Badge>
            )}
            <Button size="sm" onClick={() => test(i.id)} disabled={testing === i.id}>
              {testing === i.id ? <Spinner /> : <RefreshCw size={12} />} Test
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => del(i.id)}><Trash2 size={12} /></Button>
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
