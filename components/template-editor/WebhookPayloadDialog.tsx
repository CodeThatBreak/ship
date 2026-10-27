/**
 * The template gallery's "Copy webhook payload" table action: the dialog picks
 * the delivery's repo + harness (+ its exec mode), builds the request body —
 * the reserved keys the engine reads at flow start (`repo`, `execution_mode`)
 * plus the start contract's input fields (the template's input params) — and
 * shows the whole curl that sends it. The secret is masked on screen but
 * carried in the copied text (same posture as the editor's hook card).
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, RefreshCw } from "lucide-react";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Field, FieldLabel, FieldTitle } from "../ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { useCopy } from "../../hooks/use-copy";
import { queryKeys } from "@/constants/query-keys";
import { fetchRepos, fetchSettings, type Harness, type Repo } from "../settings";
import { schemaRows } from "./variables";

/** The saved template's start-node row (same catalog id the editor looks
 *  for); its instance config carries the start contract. */
const START_NODE_TEMPLATE_ID = "nt_start";

/** One start-contract field — the sample body's input params. */
type ContractField = { key: string; label?: string; type?: string; required?: boolean };

/** The template's flow-trigger hook (GET /api/templates response slice). */
type HookInfo = { id: string; secret: string; filter: string | null };
type TemplateDetailPayload = {
  hook?: HookInfo | null;
  nodes?: {
    node_template_id: string;
    config: Record<string, unknown> | null;
  }[];
};

/** fetch + parse JSON, falling back on transport/HTTP errors (same posture as
 *  the settings area's fetchJson — dialogs never throw on a bad read). */
async function fetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url);
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

/** The start node's contract as typed rows: `/api/contracts` resolves it the
 *  same way the editor does (`def` + the instance `config` — the contract is
 *  per instance). */
async function fetchContractFields(
  config: Record<string, unknown> | null,
): Promise<ContractField[]> {
  const p = new URLSearchParams();
  p.set("def", START_NODE_TEMPLATE_ID);
  if (config && Object.keys(config).length) p.set("config", JSON.stringify(config));
  const contract = await fetchJson<{ output?: unknown }>(`/api/contracts?${p.toString()}`, {});
  return schemaRows(contract.output).map((r) => ({
    key: r.name,
    label: r.description,
    type: r.type,
    required: r.required,
  }));
}

/** The dialog's context: the input fields + the provisioned hook (null until
 *  the template is saved with its side effects — the curl needs it). */
async function fetchWebhookContext(
  templateId: string,
): Promise<{ fields: ContractField[]; hook: HookInfo | null }> {
  const detail = await fetchJson<TemplateDetailPayload>(
    `/api/templates/${templateId}`,
    {},
  );
  const start = detail.nodes?.find((n) => n.node_template_id === START_NODE_TEMPLATE_ID);
  const fields = start ? await fetchContractFields(start.config ?? null) : [];
  return { fields, hook: detail.hook ?? null };
}

/** A placeholder value matching the declared field type (the sender replaces
 *  whatever applies). */
function sampleValue(field: ContractField): unknown {
  switch (field.type) {
    case "number": return 0;
    case "boolean": return true;
    case "object": return {};
    case "array": return [];
    default: return `<${field.key}>`;
  }
}

/** The friendly repo label (the "(local)" suffix marks the local checkout). */
const repoLabel = (r: Repo) => `${r.name}${r.local_path ? " (local)" : ""}`;

/** Shell-quote a string for the curl's `-d '…'` (embedds safely even when the
 *  body carries apostrophes). */
function shellSingleQuoted(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}

export function WebhookPayloadDialog({
  template,
  defaultRepoId,
  onClose,
}: {
  /** the row the action ran on — null = closed */
  template: { id: string; name: string } | null;
  /** the template's bound repo (the repo select's preselection) */
  defaultRepoId?: string | null;
  onClose: () => void;
}) {
  const open = template != null;
  const templateId = template?.id ?? "";
  const { copied, copy } = useCopy();

  // selections: null until the user picks — every default resolves from the
  // data (the bound repo, the settings' harness/mode defaults) below
  const [repoId, setRepoId] = useState<string | null>(null);
  const [harnessKey, setHarnessKey] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  // the page origin — browser-only state read after mount (hydration safe;
  // dialogs only render client-side)
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const settingsQuery = useQuery({
    queryKey: queryKeys.settings,
    queryFn: fetchSettings,
    enabled: open,
  });
  const reposQuery = useQuery({
    queryKey: queryKeys.repos,
    queryFn: fetchRepos,
    enabled: open,
  });
  const contextQuery = useQuery({
    queryKey: queryKeys.templates.webhook(templateId),
    queryFn: () => fetchWebhookContext(templateId),
    enabled: open,
  });

  const repos = reposQuery.data ?? [];
  const settings = settingsQuery.data ?? null;
  const loading =
    settingsQuery.isPending || reposQuery.isPending || (open && contextQuery.isPending);
  const failed =
    (open && contextQuery.isError) || reposQuery.isError || settingsQuery.isError;

  // effective selections: the user's pick wins; otherwise the template's
  // binding, then the settings defaults, then the first valid option
  const repo =
    repos.find((r) => r.id === (repoId ?? defaultRepoId ?? "")) ?? repos[0] ?? null;
  const harnesses = settings?.harnesses ?? [];
  const harness: Harness | null =
    harnesses.find((h) => h.key === (harnessKey ?? settings?.default_harness ?? "")) ??
    harnesses[0] ??
    null;
  const modeValue: string | null = harness?.modes.find(
    (m) => m.value === (mode ?? settings?.default_execution_mode ?? ""),
  )?.value ?? harness?.modes[0]?.value ?? null;

  const payload = {
    // reserved keys consumed at flow start (never contract data): the repo the
    // flow attaches to (id / URL / registered name) and the exec mode to pin
    ...(repo ? { repo: repo.name } : {}),
    ...(modeValue ? { execution_mode: modeValue } : {}),
    ...Object.fromEntries(
      (contextQuery.data?.fields ?? []).map((f) => [f.key, sampleValue(f)]),
    ),
  };
  const payloadText = JSON.stringify(payload, null, 2);
  const hook = contextQuery.data?.hook ?? null;
  // the whole curl — endpoint, secret header and the body — displayed with the
  // secret masked, copied verbatim (the sender needs the real secret to sign)
  const curlText = hook
    ? `curl -X POST ${origin}/api/hooks/${hook.id} ` +
      `-H "content-type: application/json" ` +
      `-H "x-devflow-secret: ${hook.secret}" ` +
      `-d ${shellSingleQuoted(payloadText)}`
    : null;
  // the display's masked form: the secret is the split point — the real value
  // only ever lives in the copied text (`hook-verify-copy` never renders it)
  let curlBefore = "";
  let curlAfter = "";
  if (hook && curlText) {
    const parts = curlText.split(hook.secret);
    curlBefore = parts[0] ?? "";
    curlAfter = parts.slice(1).join(hook.secret);
  }

  /** one block's header: label + inline copy (masked text, full copy). */
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
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
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

          {/* Repo — preselected from the template's binding when set */}
          <Field>
            <FieldLabel htmlFor="webhook-repo">Repo</FieldLabel>
            {reposQuery.isPending ? (
              <Skeleton className="h-9 rounded-lg" />
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

          {/* Harness → mode cascade (same shape as the settings General page) */}
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

          {/* The body itself — the delivery JSON the curl sends */}
          <Field>
            {blockLabel(
              "Payload (request body)",
              () => payloadText,
            )}
            {contextQuery.isPending ? (
              <Skeleton className="h-20 rounded-lg" />
            ) : (
              <pre className="max-h-44 overflow-auto rounded-lg bg-muted p-2 font-mono text-[12px] m-0 whitespace-pre-wrap break-all">
                {payloadText}
              </pre>
            )}
          </Field>

          {/* The whole curl — endpoint + secret + the body above */}
          <Field>
            {blockLabel(
              "Curl — send this body to the hook",
              () => curlText ?? "",
            )}
            {hook && contextQuery.data ? (
              <pre className="max-h-44 overflow-auto rounded-lg bg-muted p-2 font-mono text-[12px] m-0 whitespace-pre-wrap break-all">
                {curlBefore}
                <span className="text-muted-foreground/70">••••</span>
                {curlAfter}
              </pre>
            ) : (
              <p className="text-[11px] text-muted-foreground m-0">
                The hook endpoint appears once the template is saved or
                duplicated.
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
}
