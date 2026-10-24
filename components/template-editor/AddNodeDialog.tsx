"use client";
import { useEffect, useMemo, useState } from "react";
import { Bot, Compass, Gauge, Hammer, Plus, ScanSearch, SquareCheck, Wand2, Wrench } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { iconForIconName } from "./icons";
import { SelectOption } from "./NodeConfigurator";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import type { EditorNode, EditorEdge } from "./types";
import { parseOutputContract, schemaToInputRows, type InputFieldRow } from "./ts-schema-lite";

const BUILTIN_ICONS: Record<string, any> = {
  plan: Compass,
  build: Hammer,
  pipeline: Gauge,
  review: ScanSearch,
  resolve: SquareCheck,
};

/**
 * The add-node dialog (§8): pick a node from the catalog, or author a new
 * declarative node inline — agent (Phase 2) plus decision / http / script
 * (Phase 3). Creation stores the node in `node_templates`; adding it to the
 * template creates an instance.
 */
export interface CreateNodeDef {
  kind: "agent" | "decision" | "http" | "script";
  name: string;
  description?: string;
  config: Record<string, unknown>;
}

export default function AddNodeDialog({
  open, onClose, creativeBusy, onAddCatalogNode, onCreateNode, initialMode,
}: {
  open: boolean;
  onClose: () => void;
  creativeBusy: boolean;
  onAddCatalogNode: (rowId: string, isBuiltin: boolean, catalogKey: string, name: string) => void;
  onCreateNode: (def: CreateNodeDef) => Promise<{ err?: string; nodeTemplateId?: string }>;
  /** open directly on an authoring form (the palette's "Author new node" buttons) */
  initialMode?: "agent" | "decision" | "http" | "script";
}) {
  const [catalog, setCatalog] = useState<{ id: string; key: string; name: string; kind: string; is_builtin: boolean; description: string | null }[] | null>(null);
  const [mode, setMode] = useState<"catalog" | "agent" | "decision" | "http" | "script">("catalog");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || catalog) return;
    fetch("/api/node-templates").then((r) => r.json()).then((d) => setCatalog(d.nodeTemplates ?? [])).catch(() => setCatalog([]));
  }, [open, catalog]);

  useEffect(() => {
    if (open && initialMode) setMode(initialMode);
  }, [open, initialMode]);

  const MODES = [
    { v: "catalog", label: "Node catalog" },
    { v: "agent", label: "New agent" },
    { v: "decision", label: "New decision" },
    { v: "http", label: "New http" },
    { v: "script", label: "New script" },
  ] as const;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[620px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a node</DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 flex-wrap">
          {MODES.map((m) => (
            <button
              key={m.v}
              onClick={() => setMode(m.v)}
              className={`px-3 py-1.5 rounded-lg text-[12.5px] font-medium ${mode === m.v ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === "catalog" ? (
          <div className="grid gap-2">
            {!catalog && <Spinner />}
            {catalog?.filter((n) => !n.is_builtin).every(() => true) && (
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-[0.8px] mb-1.5">Built-in SDLC nodes</p>
                <div className="grid gap-1.5">
                  {catalog?.filter((n) => n.is_builtin).map((n) => (
                    <CatalogRow key={n.id} n={n} onPick={() => onAddCatalogNode(n.id, true, n.key, n.name)} />
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="text-[11px] text-muted-foreground uppercase tracking-[0.8px] mb-1.5">Your custom nodes</p>
              {catalog?.filter((n) => !n.is_builtin).length ? (
                <div className="grid gap-1.5">
                  {catalog?.filter((n) => !n.is_builtin).map((n) => (
                    <CatalogRow key={n.id} n={n} declarative onPick={() => onAddCatalogNode(n.id, false, n.key, n.name)} />
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-muted-foreground m-0">None yet — author one from the tabs above.</p>
              )}
            </div>
          </div>
        ) : mode === "agent" ? (
          <AgentNodeForm busy={busy || creativeBusy} disabled={busy || creativeBusy}
            onSubmit={async (def) => {
              setBusy(true);
              const r = await onCreateNode({
                kind: "agent",
                name: def.name,
                description: `Declarative agent node (${def.mode})`,
                config: {
                  prompt: def.prompt,
                  mode: def.mode,
                  model: def.model,
                  output: def.output,
                  output_schema: def.output_schema,
                  output_schema_ts: def.output_schema_ts,
                },
              });
              setBusy(false);
              return r;
            }} />
        ) : mode === "decision" ? (
          <DecisionNodeForm busy={busy || creativeBusy} disabled={busy || creativeBusy}
            onSubmit={async (def) => {
              setBusy(true);
              const r = await onCreateNode(def);
              setBusy(false);
              return r;
            }} />
        ) : mode === "http" ? (
          <HttpNodeForm busy={busy || creativeBusy} disabled={busy || creativeBusy}
            onSubmit={async (def) => {
              setBusy(true);
              const r = await onCreateNode(def);
              setBusy(false);
              return r;
            }} />
        ) : (
          <ScriptNodeForm busy={busy || creativeBusy} disabled={busy || creativeBusy}
            onSubmit={async (def) => {
              setBusy(true);
              const r = await onCreateNode(def);
              setBusy(false);
              return r;
            }} />
        )}

        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CatalogRow({ n, declarative, onPick }: {
  n: { id: string; key: string; name: string; kind: string; description: string | null };
  declarative?: boolean;
  onPick: () => void;
}) {
  const Icon = declarative ? Bot : (BUILTIN_ICONS[n.key] ?? Wrench);
  return (
    <button
      onClick={onPick}
      className="flex items-center gap-2.5 px-3 py-2 border border-border rounded-xl bg-card hover:border-blue-500/50 transition-colors text-left"
    >
      <span className="size-7 shrink-0 grid place-items-center rounded-lg bg-muted">
        <Icon size={14} className="text-muted-foreground" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-medium">{n.name}</span>
        {n.description && <span className="block text-[11.5px] text-muted-foreground truncate">{n.description}</span>}
      </span>
      {declarative ? null : <Badge variant="outline" className="text-[10px]">{n.key}</Badge>}
      <Plus size={13} className="text-muted-foreground" />
    </button>
  );
}

interface AgentFormDef {
  name: string;
  prompt: string;
  mode: string;
  model: string | null;
  output: "markdown" | "json";
  output_schema: unknown;
  /** the raw TypeScript members the schema was authored from — the drawer's
   *  schema box re-seeds from this (kept on the config, unknown-safe) */
  output_schema_ts?: string;
}

/**
 * The agent authoring form. Output is authored as text or json (§8 — the easy
 * path compiles down to the runtime's JSON-Schema output):
 *   • The node declares no input contract — the run input is inherited from
 *     the previous node's output ({{input.<field>}} addresses it directly;
 *     upstream refs are {{nodes.<key>.output.<field>}}).
 *   • Output mode comes after the prompt — `text` is the markdown artifact
 *     output; `json` takes a schema box that becomes output=json with a
 *     run-time-validated JSON Schema.
 */
function AgentNodeForm({
  busy, disabled, onSubmit,
}: {
  busy: boolean;
  disabled: boolean;
  onSubmit: (def: AgentFormDef) => Promise<{ err?: string; nodeTemplateId?: string }>;
}) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [agentMode, setAgentMode] = useState("plan");
  const [model, setModel] = useState("");
  const [outputMode, setOutputMode] = useState<"text" | "json">("text");
  const [outputTsText, setOutputTsText] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // live previews of the compiled contract (errors surface before submit)
  const outputPreview = useMemo(
    () => (outputMode === "json" && outputTsText.trim()) ? parseOutputContract(outputTsText) : null,
    [outputMode, outputTsText],
  );

  const submit = async () => {
    setErr(null);
    if (!name.trim()) {
      setErr("name is required");
      return;
    }
    let defOutput: AgentFormDef["output"] = outputMode === "json" ? "json" : "markdown";
    let defSchema: unknown = null;
    if (outputMode === "json") {
      if (!outputTsText.trim()) {
        setErr("output=json needs an output schema");
        return;
      }
      const outR = outputPreview!;
      if (outR.error || !outR.schema) { setErr(`output schema: ${outR.error ?? "declares no fields"}`); return; }
      defSchema = outR.schema;
    }
    const r = await onSubmit({
      name: name.trim(),
      prompt: prompt.trim(),
      mode: agentMode,
      model: model.trim() || null,
      output: defOutput,
      output_schema: defSchema,
      output_schema_ts: defOutput === "json" ? outputTsText : undefined,
    });
    if (r.err) setErr(r.err);
    else if (r.nodeTemplateId) {
      setName("");
      setPrompt("");
      setOutputMode("text");
      setOutputTsText("");
    }
  };

  return (
    <div className="grid gap-2.5">
      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground">Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Triage" disabled={disabled} />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">Mode</label>
          <Select value={agentMode} onValueChange={(v) => setAgentMode(v ?? agentMode)}>
            <SelectTrigger className="w-full rounded-lg border-border bg-card" disabled={disabled}>
              <SelectValue>{agentMode === "plan" ? "Plan" : "Agent"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {[
                { value: "plan", label: "Plan", Icon: iconForIconName("Compass") },
                { value: "agent", label: "Agent", Icon: iconForIconName("Sparkles") },
              ].map(({ value, label, Icon }) => (
                <SelectItem key={value} value={value}>
                  <Icon size={13} className="text-muted-foreground shrink-0" /> {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">Model</label>
          <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="flow default" disabled={disabled} />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground m-0">
        No input contract — the node inherits the connected upstream nodes&apos;
        run context: reference their outputs as <code className="font-mono">{`{{input.<field>}}`}</code>{" "}
        (previous node) or <code className="font-mono">{`{{nodes.<key>.output.<field>}}`}</code>.
      </p>

      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground">Prompt</label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={6}
          className="font-mono text-[12px]"
          disabled={disabled}
          placeholder={"Wrap up ticket {{ticket.key}} … output decision as JSON"}
        />
      </div>

      {/* ── output mode (text | json) — always after the prompt ── */}
      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground">Output mode</label>
        <select
          value={outputMode}
          onChange={(e) => setOutputMode(e.target.value as "text" | "json")}
          className="bg-card text-foreground border border-border rounded-lg text-[13px] px-3 py-2"
          disabled={disabled}
        >
          <option value="text">text — saved as a markdown artifact ({`{{nodes.<key>.output.markdown}}`})</option>
          <option value="json">json — validated against a schema ({`{{nodes.<key>.output.<field>}}`})</option>
        </select>
      </div>
      {outputMode === "json" && (
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">Output schema</label>
          <Textarea
            value={outputTsText}
            onChange={(e) => setOutputTsText(e.target.value)}
            rows={6}
            className="font-mono text-[12px]"
            disabled={disabled}
            placeholder={`{\n  summary: string\n  severity: "low" | "high"\n  files: string[]\n}`}
          />
          {outputPreview?.error && (
            <Card className="p-2.5 text-[12px] text-rose-400 border-rose-500/30">{outputPreview.error}</Card>
          )}
          {outputPreview?.schema && (
            <ContractPreview title="Output contract — validated at run time" fields={schemaToInputRows(outputPreview.schema)} />
          )}
        </div>
      )}

      {err && <Card className="p-2.5 text-[12px] text-rose-400 border-rose-500/30">{err}</Card>}
      <Button onClick={() => void submit()} disabled={disabled || busy} className="self-start">
        {busy ? <Spinner /> : <Bot size={14} />} Create agent node
      </Button>
    </div>
  );
}

/** The compiled contract preview (TypeScript mode) — the same table the node
 *  configurator's Contract tab renders. */
function ContractPreview({
  title, fields,
}: {
  title: string;
  fields: InputFieldRow[];
}) {
  // node-config contract-table style: name · type · required
  return (
    <div className="grid gap-1 text-[11.5px]">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Wand2 size={11} /> {title}
      </div>
      <div className="border border-border rounded-lg overflow-hidden text-[12px] bg-card">
        {fields.map((f) => (
          <div key={f.key} className="flex items-center gap-2 px-2.5 py-1 border-b border-border last:border-0">
            <code className="font-mono text-blue-400">{f.key}</code>
            <Badge variant="outline" className="text-[9.5px]">{f.type ?? "any"}</Badge>
            {f.required && <Badge className="bg-amber-500/10 text-amber-400 text-[9.5px]">required</Badge>}
            {f.label && <span className="text-muted-foreground truncate">— {f.label}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Phase 3 forms ────────────────────────────────────────────────────────────

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "bg-card text-foreground border border-border rounded-lg text-[13px] px-3 py-2";

const DECISION_SOURCE_OPTIONS = [
  { value: "manual", label: "Manual", description: "You pick the branch at run time in the decision card" },
  { value: "expression", label: "Expression", description: "Each choice carries a JSONata condition — the truthy conditions pick their branches" },
  { value: "agent", label: "Agent", description: "With your input and prompt, an agent determines which branch to run" },
] as const;

function DecisionNodeForm({ busy, disabled, onSubmit }: {
  busy: boolean; disabled: boolean;
  onSubmit: (def: CreateNodeDef) => Promise<{ err?: string; nodeTemplateId?: string }>;
}) {
  const [name, setName] = useState("");
  const [source, setSource] = useState<"expression" | "manual" | "agent">("manual");
  const [question, setQuestion] = useState("");
  const [choices, setChoices] = useState<{ label: string; description: string; condition: string }[]>([
    { label: "", description: "", condition: "" }, { label: "", description: "", condition: "" },
  ]);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!name.trim()) { setErr("name is required"); return; }
    const cs = choices.filter((c) => c.label.trim());
    if (!cs.length) { setErr("at least one choice label is required"); return; }
    if (source === "expression" && !cs.some((c) => c.condition.trim())) {
      setErr("an expression source needs at least one choice condition (JSONata)");
      return;
    }
    const r = await onSubmit({
      kind: "decision",
      name: name.trim(),
      description: `Decision (${source})`,
      config: {
        source,
        question: question.trim(),
        choices: cs.map((c) => ({
          label: c.label.trim(),
          description: c.description.trim() || undefined,
          condition: c.condition.trim() || undefined,
        })),
      },
    });
    if (r.err) setErr(r.err);
  };

  return (
    <div className="grid gap-2.5">
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Worth fixing?" disabled={disabled} /></Field>
      <Field label="Source">
        <Select value={source} onValueChange={(v) => setSource((v ?? source) as typeof source)}>
          <SelectTrigger className="w-full rounded-lg border-border bg-card" disabled={disabled}>
            <SelectValue>
              {DECISION_SOURCE_OPTIONS.find((o) => o.value === source)?.label ?? source}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {DECISION_SOURCE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                <SelectOption label={o.label} description={o.description} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {source === "agent" && (
        <Field label="Prompt (how to make the decision — the branch list and the JSON return format are added automatically)">
          <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} className="font-mono text-[12px]"
            placeholder="Given the triage result, is this issue worth an automated fix PR? Compare severity and blast radius." disabled={disabled} />
        </Field>
      )}
      <Field label={source === "expression"
        ? "Choices (label + JSONata condition — every truthy condition picks its branch)"
        : "Choices (label + description — descriptions steer an agent classifier)"}>
        <div className="grid gap-1.5">
          {choices.map((c, i) => (
            <div key={i} className="grid gap-1.5 rounded-lg border border-border p-2">
              <div className="flex gap-1.5">
                <Input value={c.label} onChange={(e) => setChoices(choices.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  placeholder="label" className="max-w-[140px] font-mono" disabled={disabled} />
                <Input value={c.description} onChange={(e) => setChoices(choices.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                  placeholder="description" disabled={disabled} />
                <Button variant="ghost" size="sm" onClick={() => setChoices(choices.filter((_, j) => j !== i))} disabled={disabled || choices.length <= 1}>
                  <Wrench size={12} />
                </Button>
              </div>
              {source === "expression" && (
                <Textarea value={c.condition}
                  onChange={(e) => setChoices(choices.map((x, j) => (j === i ? { ...x, condition: e.target.value } : x)))}
                  rows={2} className="font-mono text-[11.5px]" disabled={disabled}
                  placeholder="JSONata condition — truthy picks this branch, e.g. nodes.review.output.comment_count > 0" />
              )}
            </div>
          ))}
          <Button variant="outline" size="sm" className="self-start" onClick={() => setChoices([...choices, { label: "", description: "", condition: "" }])} disabled={disabled}>
            <Plus size={12} /> Add choice
          </Button>
        </div>
      </Field>
      <p className="text-[11px] text-muted-foreground m-0">
        Outgoing edges are wired per branch — the canvas gives each choice its own labeled connector;
        drag from it to attach the next node (no per-edge editing), and the edge carries that branch label.
      </p>
      {err && <Card className="p-2.5 text-[12px] text-rose-400 border-rose-500/30">{err}</Card>}
      <Button onClick={() => void submit()} disabled={disabled || busy} className="self-start">
        {busy ? <Spinner /> : <Plus size={14} />} Create decision node
      </Button>
    </div>
  );
}

function HttpNodeForm({ busy, disabled, onSubmit }: {
  busy: boolean; disabled: boolean;
  onSubmit: (def: CreateNodeDef) => Promise<{ err?: string; nodeTemplateId?: string }>;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState("POST");
  const [headers, setHeaders] = useState('{\n  "Content-Type": "application/json"\n}');
  const [body, setBody] = useState("");
  const [responseMap, setResponseMap] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!name.trim()) { setErr("name is required"); return; }
    if (!url.trim()) { setErr("a URL is required"); return; }
    let parsedHeaders: Record<string, string> = {};
    try {
      parsedHeaders = headers.trim() ? JSON.parse(headers) : {};
      if (typeof parsedHeaders !== "object" || Array.isArray(parsedHeaders) || !parsedHeaders) throw new Error("must be an object");
    } catch (e) {
      setErr(`headers must be a JSON object: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const r = await onSubmit({
      kind: "http",
      name: name.trim(),
      description: `Outbound ${method} call`,
      config: {
        url: url.trim(),
        method,
        headers: parsedHeaders,
        body: body.trim() || null,
        timeout_ms: 30000,
        response_map: responseMap.trim() || null,
      },
    });
    if (r.err) setErr(r.err);
  };

  return (
    <div className="grid gap-2.5">
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Notify Slack" disabled={disabled} /></Field>
      <div className="grid grid-cols-[120px_1fr] gap-2.5">
        <Field label="Method">
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls} disabled={disabled}>
            {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="URL ({{vars}} and {{secrets.NAME}} allowed)">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono text-[12px]"
            placeholder="{{secrets.SLACK_WEBHOOK}}" disabled={disabled} />
        </Field>
      </div>
      <Field label="Headers (JSON object)">
        <Textarea value={headers} onChange={(e) => setHeaders(e.target.value)} rows={3} className="font-mono text-[12px]" disabled={disabled} />
      </Field>
      <Field label="Body (sent as-is; {{...}} interpolated)">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="font-mono text-[12px]"
          placeholder={'{ "text": "Triaged {{ticket.key}}: {{nodes.triage.output.summary}}" }'} disabled={disabled} />
      </Field>
      <Field label="Response map (optional JSONata over {status, ok, body, headers} — must yield an object)">
        <Input value={responseMap} onChange={(e) => setResponseMap(e.target.value)} className="font-mono text-[12px]"
          placeholder='{ "ok": status = 200, "body": body }' disabled={disabled} />
      </Field>
      <p className="text-[11px] text-muted-foreground m-0">
        The host must be on the HTTP allowlist (Settings → Custom nodes); calls pass the SSRF guard.
      </p>
      {err && <Card className="p-2.5 text-[12px] text-rose-400 border-rose-500/30">{err}</Card>}
      <Button onClick={() => void submit()} disabled={disabled || busy} className="self-start">
        {busy ? <Spinner /> : <Plus size={14} />} Create http node
      </Button>
    </div>
  );
}

function ScriptNodeForm({ busy, disabled, onSubmit }: {
  busy: boolean; disabled: boolean;
  onSubmit: (def: CreateNodeDef) => Promise<{ err?: string; nodeTemplateId?: string }>;
}) {
  const [name, setName] = useState("");
  const [runtime, setRuntime] = useState<"shell" | "node" | "python">("shell");
  const [script, setScript] = useState("");
  const [cwd, setCwd] = useState<"repo" | "workspace">("repo");
  const [schemaText, setSchemaText] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!name.trim()) { setErr("name is required"); return; }
    if (!script.trim()) { setErr("a script is required"); return; }
    let output_schema: unknown = null;
    if (schemaText.trim()) {
      try {
        output_schema = JSON.parse(schemaText);
      } catch (e) {
        setErr(`output_schema is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
    const r = await onSubmit({
      kind: "script",
      name: name.trim(),
      description: `Local ${runtime} script`,
      config: { runtime, script, cwd, timeout_ms: 120000, env: [], output_schema },
    });
    if (r.err) setErr(r.err);
  };

  return (
    <div className="grid gap-2.5">
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Read package version" disabled={disabled} /></Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Runtime">
          <select value={runtime} onChange={(e) => setRuntime(e.target.value as typeof runtime)} className={inputCls} disabled={disabled}>
            <option value="shell">shell — POSIX sh</option>
            <option value="node">node — Node.js</option>
            <option value="python">python — python3</option>
          </select>
        </Field>
        <Field label="Working directory">
          <select value={cwd} onChange={(e) => setCwd(e.target.value as typeof cwd)} className={inputCls} disabled={disabled}>
            <option value="repo">repo — the repo's local checkout</option>
            <option value="workspace">workspace — the per-flow workspace clone</option>
          </select>
        </Field>
      </div>
      <Field label="Script (stdin gets the mapped input JSON; the last stdout line — or the $DEVFLOW_OUTPUT file — is the output JSON)">
        <Textarea value={script} onChange={(e) => setScript(e.target.value)} rows={6} className="font-mono text-[12px]"
          placeholder={"jq '.version' package.json | awk '{print \"{\\\"version\\\": \" $0 \"}\"}'"} disabled={disabled} />
      </Field>
      <Field label="Output schema (optional JSON Schema the output JSON must satisfy)">
        <Textarea value={schemaText} onChange={(e) => setSchemaText(e.target.value)} rows={4} className="font-mono text-[12px]"
          placeholder={'{ "type": "object", "required": ["version"], "properties": { "version": { "type": "string" } } }'} disabled={disabled} />
      </Field>
      <p className="text-[11px] text-muted-foreground m-0">
        Scripts run with your user permissions (same trust as npm run) — local/self-hosted audience.
      </p>
      {err && <Card className="p-2.5 text-[12px] text-rose-400 border-rose-500/30">{err}</Card>}
      <Button onClick={() => void submit()} disabled={disabled || busy} className="self-start">
        {busy ? <Spinner /> : <Plus size={14} />} Create script node
      </Button>
    </div>
  );
}
