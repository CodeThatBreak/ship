"use client";
import { useState } from "react";
import {
  CheckCircle2, Database, FolderGit2, GitBranch, Pencil, Plus, Trash2, XCircle,
} from "lucide-react";
import type { Repo } from "@/components/settings/context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export function ReposSection({ repos, onChanged, onError }: { repos: Repo[]; onChanged: () => void; onError: (e: string | null) => void }) {
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
                    ? <CheckCircle2 size={12} className="text-success" />
                    : <XCircle size={12} className="text-destructive" />
                )}
              </div>
            </div>
            <Badge><GitBranch size={11} /> {r.default_branch}</Badge>
            {r.local_path && <Badge className="bg-info/10 text-info">local-ready</Badge>}
            <Button size="sm" onClick={() => { setEditing(r.id); setForm({
              name: r.name, cloud_url: r.cloud_url, local_path: r.local_path ?? "", default_branch: r.default_branch,
              install_command: r.install_command ?? "", skip_install: Boolean(r.skip_install),
              sync_paths: r.sync_paths ?? "", shared_dirs: r.shared_dirs ?? "", setup_command: r.setup_command ?? "",
            }); }}>
              <Pencil size={12} /> Edit
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => del(r.id)}><Trash2 size={12} /></Button>
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
