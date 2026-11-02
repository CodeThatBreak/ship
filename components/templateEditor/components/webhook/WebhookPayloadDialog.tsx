"use client";
/**
 * The template gallery's "Copy webhook payload" table action: the dialog picks
 * the delivery's repo + harness (+ its exec mode), builds the request body,
 * and shows the whole curl that sends it.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, RefreshCw } from "lucide-react";
import { Alert } from '../../../ui/alert';
import { Button } from '../../../ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../ui/dialog';
import { Field, FieldLabel, FieldTitle } from '../../../ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../ui/select';
import { Skeleton } from '../../../ui/skeleton';
import { useCopy } from "@/hooks/useCopy";
import { queryKeys } from "@/constants/queryKeys";
import { settingsQueryOptions, reposQueryOptions, reposFromQueryData } from "@/components/settings/queries";
import type { Harness } from "@/types/settings";
import {
  fetchWebhookContext,
  repoLabel,
  sampleValue,
  shellSingleQuoted,
} from './webhookPayloadUtils';

export const WebhookPayloadDialog = ({
  template,
  defaultRepoId,
  onClose,
}: {
  template: { id: string; name: string } | null;
  defaultRepoId?: string | null;
  onClose: () => void;
}) => {
  const open = template != null;
  const templateId = template?.id ?? "";
  const { copied, copy } = useCopy();

  const [repoId, setRepoId] = useState<string | null>(null);
  const [harnessKey, setHarnessKey] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const settingsQuery = useQuery({
    ...settingsQueryOptions(),
    enabled: open,
  });
  const reposQuery = useQuery({
    ...reposQueryOptions(),
    enabled: open,
  });
  const contextQuery = useQuery({
    queryKey: queryKeys.templates.webhook(templateId),
    queryFn: () => fetchWebhookContext(templateId),
    enabled: open,
  });

  const repos = reposFromQueryData(reposQuery.data);
  const settings = settingsQuery.data ?? null;
  const loading =
    settingsQuery.isPending || reposQuery.isPending || (open && contextQuery.isPending);
  const failed =
    (open && contextQuery.isError) || reposQuery.isError || settingsQuery.isError;

  const repo =
    repos.find((r) => r.id === (repoId ?? defaultRepoId ?? "")) ?? repos[0] ?? null;
  const harnesses = settings?.harnesses ?? [];
  const harness: Harness | null =
    harnesses.find((h) => h.key === (harnessKey ?? settings?.default_harness ?? "")) ??
    harnesses[0] ??
    null;
  const modeValue: string | null =
    harness?.modes.find((m) => m.value === (mode ?? settings?.default_execution_mode ?? ""))
      ?.value ??
    harness?.modes[0]?.value ??
    null;

  const payload = {
    ...(repo ? { repo: repo.name } : {}),
    ...(modeValue ? { execution_mode: modeValue } : {}),
    ...Object.fromEntries(
      (contextQuery.data?.fields ?? []).map((f) => [f.key, sampleValue(f)]),
    ),
  };
  const payloadText = JSON.stringify(payload, null, 2);
  const hook = contextQuery.data?.hook ?? null;
  const curlText = hook
    ? `curl -X POST ${origin}/api/hooks/${hook.id} ` +
      `-H "content-type: application/json" ` +
      `-H "webhook-id: demo-delivery-1" ` +
      `-H "webhook-timestamp: $(date +%s)" ` +
      `-H "x-devflow-secret: ${hook.secret}" ` +
      `-d ${shellSingleQuoted(payloadText)}`
    : null;
  let curlBefore = "";
  let curlAfter = "";
  if (hook && curlText) {
    const parts = curlText.split(hook.secret);
    curlBefore = parts[0] ?? "";
    curlAfter = parts.slice(1).join(hook.secret);
  }

  const blockLabel = (label: string, text: () => string) => (
    <div className="flex items-center justify-between gap-2">
      <FieldTitle>{label}</FieldTitle>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-foreground shrink-0"
        title={`Copy ${label.toLowerCase()}`}
        onClick={() => void copy(text())}
      >
        {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
      </Button>
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Copy webhook payload — {template?.name ?? ""}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <p className="text-[12px] text-muted-foreground m-0">
            Pick what the delivery pins — the engine consumes these at flow
            start. The remaining body fields must match the template&apos;s
            start contract (<code className="font-mono">{"{{trigger.payload.*}}"}</code>).
          </p>

          {!loading && failed && (
            <Alert variant="destructive" className="flex items-center gap-2">
              <span>Couldn&apos;t load the payload inputs.</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void settingsQuery.refetch();
                  void reposQuery.refetch();
                  void contextQuery.refetch();
                }}
              >
                <RefreshCw size={12} /> Retry
              </Button>
            </Alert>
          )}

          <Field>
            <FieldLabel htmlFor="webhook-repo">Repo</FieldLabel>
            {reposQuery.isPending ? (
              <Skeleton className="h-9 rounded-lg" />
            ) : reposQuery.isError ? (
              <p className="text-[12px] text-destructive m-0">Couldn&apos;t load repos.</p>
            ) : repos.length === 0 ? (
              <div
                className="flex h-9 items-center rounded-lg border border-dashed border-border bg-muted/30 px-3 text-[12.5px] text-muted-foreground"
                aria-disabled
              >
                no repos imported yet — add one in Settings → Repositories
              </div>
            ) : (
              <Select value={repo?.id ?? ""} onValueChange={(v) => setRepoId(v)}>
                <SelectTrigger
                  id="webhook-repo"
                  className="w-full rounded-lg border-border bg-card"
                  aria-label="Repo"
                >
                  <SelectValue>{repo ? repoLabel(repo) : ""}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {repos.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {repoLabel(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field>
              <FieldLabel htmlFor="webhook-harness">Harness</FieldLabel>
              {settingsQuery.isPending ? (
                <Skeleton className="h-9 rounded-lg" />
              ) : harness ? (
                <Select value={harness.key} onValueChange={(v) => setHarnessKey(v)}>
                  <SelectTrigger
                    id="webhook-harness"
                    className="w-full rounded-lg border-border bg-card"
                    aria-label="Harness"
                  >
                    <SelectValue>{harness.label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {harnesses.map((h: Harness) => (
                      <SelectItem key={h.key} value={h.key}>
                        {h.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div
                  className="flex h-9 items-center rounded-lg border border-dashed border-border bg-muted/30 px-3 text-[12.5px] text-muted-foreground"
                  aria-disabled
                >
                  no harness connected — Settings → Integrations
                </div>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="webhook-mode">Mode</FieldLabel>
              {settingsQuery.isPending ? (
                <Skeleton className="h-9 rounded-lg" />
              ) : harness?.modes.length ? (
                <Select value={modeValue ?? ""} onValueChange={(v) => setMode(v)}>
                  <SelectTrigger
                    id="webhook-mode"
                    className="w-full rounded-lg border-border bg-card"
                    aria-label="Execution mode"
                  >
                    <SelectValue>
                      {harness.modes.find((m) => m.value === modeValue)?.label ?? ""}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {harness.modes.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                        {!m.configured && " · not configured"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div
                  className="flex h-9 items-center rounded-lg border border-dashed border-border bg-muted/30 px-3 text-[12.5px] text-muted-foreground"
                  aria-disabled
                >
                  —
                </div>
              )}
            </Field>
          </div>

          <Field>
            {blockLabel("Payload (request body)", () => payloadText)}
            {contextQuery.isPending ? (
              <Skeleton className="h-20 rounded-lg" />
            ) : (
              <pre className="max-h-44 overflow-auto rounded-lg bg-muted p-2 font-mono text-[12px] m-0 whitespace-pre-wrap break-all">
                {payloadText}
              </pre>
            )}
          </Field>

          <Field>
            {blockLabel("Curl — send this body to the hook", () => curlText ?? "")}
            {hook && contextQuery.data && !contextQuery.isError ? (
              <pre className="max-h-44 overflow-auto rounded-lg bg-muted p-2 font-mono text-[12px] m-0 whitespace-pre-wrap break-all">
                {curlBefore}
                <span className="text-muted-foreground/70">••••</span>
                {curlAfter}
              </pre>
            ) : contextQuery.isError ? (
              <p className="text-[11px] text-destructive m-0">
                Couldn&apos;t load the hook endpoint — use Retry above.
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground m-0">
                The hook endpoint appears once the template is saved or duplicated.
              </p>
            )}
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => curlText && void copy(curlText)}
            disabled={!repo || !modeValue || !curlText}
          >
            {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
            {copied ? "Curl copied" : "Copy curl"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
