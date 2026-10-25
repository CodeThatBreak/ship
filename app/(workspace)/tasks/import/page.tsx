"use client";
import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2, Download, Inbox, ListTree, RefreshCw, XCircle,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

/**
 * Import screen (Phase 2 — "Task acquisition: import screen only"): lists the
 * registered task providers (from GET /api/tasks/providers) as connect /
 * import cards and runs their sync via POST /api/tasks {kind}. Tasks only
 * come from integrations — there is no manual task-creation UI, anywhere.
 */

type TaskField = { key: string; label: string; type: string; required?: boolean };
type Provider = { kind: string; label: string; configured: boolean; contextFields: TaskField[] };
type ImportedTask = { id: string; key: string; summary: string };

type SyncState =
  | { state: "syncing" }
  | { state: "done"; synced: number; tasks: ImportedTask[] }
  | { state: "error"; error: string };

export default function TaskImportPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [sync, setSync] = useState<Record<string, SyncState>>({});

  const load = useCallback(async () => {
    const p = await fetch("/api/tasks/providers").then((r) => r.json()).catch(() => null);
    setProviders(p?.providers ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (provider: Provider) => {
    setSync((prev) => ({ ...prev, [provider.kind]: { state: "syncing" } }));
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: provider.kind }),
      });
      const body = await res.json();
      if (!res.ok || body.error) {
        setSync((prev) => ({ ...prev, [provider.kind]: { state: "error", error: body.error ?? `import failed (${res.status})` } }));
      } else {
        setSync((prev) => ({ ...prev, [provider.kind]: { state: "done", synced: body.synced, tasks: body.tasks ?? [] } }));
      }
    } catch (err) {
      setSync((prev) => ({ ...prev, [provider.kind]: { state: "error", error: err instanceof Error ? err.message : String(err) } }));
    }
  };

  return (
    <>
      <header className="flex items-end justify-between gap-4 mb-7">
        <div>
          <h1 className="text-lg font-semibold tracking-tight m-0">Import tasks</h1>
          <p className="text-[13px] text-muted-foreground mt-1 mb-0">
            Pull in issues from your connected providers — idempotent on the issue key.
          </p>
        </div>
      </header>

      <p className="text-muted-foreground text-[12.5px] mb-6">
        Tasks come exclusively from integrations — each provider below pulls its
        external issues into DevFlow. Connect an integration by filling in its
        credentials in <code className="font-mono">.env</code>, then import.
      </p>

      {providers.length === 0 && (
        <Card className="justify-center items-center gap-2 py-10 border-dashed! shadow-none! text-muted-foreground">
          <div className="size-10 grid place-items-center rounded-lg bg-muted">
            <Inbox size={18} />
          </div>
          <div className="text-sm font-medium text-foreground">No task providers</div>
          <div className="text-[12.5px]">Register a provider to import tasks.</div>
        </Card>
      )}

      <div className="grid gap-3">
        {providers.map((p) => {
          const s = sync[p.kind];
          return (
            <Card key={p.kind} className="p-4 grid gap-3">
              <div className="flex gap-2.5 items-center flex-wrap">
                <Download size={15} className="text-muted-foreground shrink-0" />
                <span className="font-medium text-[14px]">{p.label}</span>
                <Badge variant="outline" className="font-mono text-[11px]">{p.kind}</Badge>
                {p.configured ? (
                  <Badge className="bg-success/10 text-success">
                    <CheckCircle2 size={11} /> connected
                  </Badge>
                ) : (
                  <Badge className="bg-warning/10 text-warning">
                    <XCircle size={11} /> not configured (.env)
                  </Badge>
                )}
                <span className="flex-1" />
                <Button size="sm" onClick={() => run(p)} disabled={s?.state === "syncing"}>
                  {s?.state === "syncing" ? <Spinner /> : <RefreshCw size={13} />}
                  Import from {p.label}
                </Button>
              </div>

              <div className="flex gap-1.5 flex-wrap items-center">
                <span className="text-[11px] text-muted-foreground uppercase tracking-[0.6px] mr-0.5">
                  Context fields
                </span>
                {p.contextFields.map((f) => (
                  <Badge
                    key={f.key}
                    variant="outline"
                    className="font-mono text-[10.5px]"
                    title={`${f.label} (${f.type})${f.required ? " — required" : ""}`}
                  >
                    {`{{task.${f.key}}}`}
                  </Badge>
                ))}
              </div>

              {s?.state === "error" && (
                <Alert variant="destructive">
                  <XCircle size={15} />
                  <span className="flex-1">{s.error}</span>
                </Alert>
              )}

              {s?.state === "done" && (
                <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-success mb-1.5">
                    <CheckCircle2 size={13} />
                    {s.synced === 0 ? "Nothing new to import" : `Imported ${s.synced} task${s.synced === 1 ? "" : "s"}`}
                  </div>
                  {s.tasks.length > 0 && (
                    <div className="grid gap-0.5">
                      {s.tasks.map((t) => (
                        <div key={t.id} className="flex gap-2 items-center px-1 py-0.5">
                          <ListTree size={11} className="text-muted-foreground shrink-0" />
                          <span className="font-mono text-[11.5px] text-info">{t.key}</span>
                          <span className="flex-1 min-w-0 text-[12.5px] truncate">{t.summary}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
