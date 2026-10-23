"use client";
import { useEffect, useState } from "react";
import { Bot, Compass, Gauge, Hammer, Plus, ScanSearch, SquareCheck, Wrench } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import type { EditorNode, EditorEdge } from "./types";

const BUILTIN_ICONS: Record<string, any> = {
  plan: Compass,
  build: Hammer,
  pipeline: Gauge,
  review: ScanSearch,
  resolve: SquareCheck,
};

/**
 * The add-node dialog (§8): pick a node from the catalog, or author a new
 * declarative agent node inline — name, prompt (with {{vars}}), mode, output
 * type (+ JSON Schema), and declared input fields. Creation stores the node
 * in `node_templates`; adding it to the template creates an instance.
 */
export default function AddNodeDialog({
  open, onClose, creativeBusy, onAddCatalogNode, onCreateAgentNode,
}: {
  open: boolean;
  onClose: () => void;
  creativeBusy: boolean;
  onAddCatalogNode: (rowId: string, isBuiltin: boolean, catalogKey: string, name: string) => void;
  onCreateAgentNode: (def: {
    name: string;
    prompt: string;
    mode: string;
    model: string | null;
    output: "markdown" | "json";
    output_schema: unknown;
    inputs: { key: string; label?: string; type?: string; required?: boolean }[];
  }) => Promise<{ err?: string; nodeTemplateId?: string }>;
}) {
  const [catalog, setCatalog] = useState<{ id: string; key: string; name: string; kind: string; is_builtin: boolean; description: string | null }[] | null>(null);
  const [mode, setMode] = useState<"catalog" | "agent">("catalog");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || catalog) return;
    fetch("/api/node-templates").then((r) => r.json()).then((d) => setCatalog(d.nodeTemplates ?? [])).catch(() => setCatalog([]));
  }, [open, catalog]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[620px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a node</DialogTitle>
        </DialogHeader>

        <div className="flex gap-1">
          {(["catalog", "agent"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-lg text-[12.5px] font-medium ${mode === m ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {m === "catalog" ? "Node catalog" : "New agent node"}
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
              <p className="text-[11px] text-muted-foreground uppercase tracking-[0.8px] mb-1.5">Your agent nodes</p>
              {catalog?.filter((n) => !n.is_builtin).length ? (
                <div className="grid gap-1.5">
                  {catalog?.filter((n) => !n.is_builtin).map((n) => (
                    <CatalogRow key={n.id} n={n} declarative onPick={() => onAddCatalogNode(n.id, false, n.key, n.name)} />
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-muted-foreground m-0">None yet — author one below.</p>
              )}
            </div>
          </div>
        ) : (
          <AgentNodeForm busy={busy || creativeBusy} disabled={busy || creativeBusy}
            onSubmit={async (def) => {
              setBusy(true);
              const r = await onCreateAgentNode(def);
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
  inputs: { key: string; label?: string; type?: string; required?: boolean }[];
}

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
  const [output, setOutput] = useState<"markdown" | "json">("markdown");
  const [schemaText, setSchemaText] = useState("");
  const [inputs, setInputs] = useState<AgentFormDef["inputs"]>([]);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!name.trim()) {
      setErr("name is required");
      return;
    }
    let output_schema: unknown = null;
    if (output === "json") {
      if (!schemaText.trim()) {
        setErr("output=json needs a JSON Schema for the output contract");
        return;
      }
      try {
        output_schema = JSON.parse(schemaText);
      } catch (e) {
        setErr(`output_schema is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
    const r = await onSubmit({
      name: name.trim(),
      prompt: prompt.trim(),
      mode: agentMode,
      model: model.trim() || null,
      output,
      output_schema,
      inputs: inputs.filter((i) => i.key.trim()),
    });
    if (r.err) setErr(r.err);
    else if (r.nodeTemplateId) {
      setName("");
      setPrompt("");
      setOutput("markdown");
      setSchemaText("");
      setInputs([]);
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
          <select value={agentMode} onChange={(e) => setAgentMode(e.target.value)} className="bg-card text-foreground border border-border rounded-lg text-[13px] px-3 py-2" disabled={disabled}>
            <option value="plan">plan (read-only)</option>
            <option value="agent">agent (repo workspace)</option>
          </select>
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">Model</label>
          <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="flow default" disabled={disabled} />
        </div>
      </div>
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
      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground">Output</label>
        <select value={output} onChange={(e) => setOutput(e.target.value as "markdown" | "json")} className="bg-card text-foreground border border-border rounded-lg text-[13px] px-3 py-2" disabled={disabled}>
          <option value="markdown">markdown — saved as an artifact ({`{{nodes.<key>.output.markdown}}`})</option>
          <option value="json">json — validated against a schema ({`{{nodes.<key>.output.<field>}}`})</option>
        </select>
      </div>
      {output === "json" && (
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">Output schema (JSON Schema — required properties + types)</label>
          <Textarea
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
            rows={7}
            className="font-mono text-[12px]"
            disabled={disabled}
            placeholder={`{\n  "type": "object",\n  "required": ["severity"],\n  "properties": { "severity": { "enum": ["low", "med", "high"] } }\n}`}
          />
        </div>
      )}
      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground">Declared inputs <span className="opacity-60">(contract display; mapping evaluates in Phase 3)</span></label>
        {inputs.map((inp, i) => (
          <div key={i} className="flex gap-1.5 items-center">
            <Input value={inp.key} onChange={(e) => setInputs((prev) => prev.map((p, j) => (j === i ? { ...p, key: e.target.value } : p)))} placeholder="key" className="max-w-[140px]" disabled={disabled} />
            <Input value={inp.label ?? ""} onChange={(e) => setInputs((prev) => prev.map((p, j) => (j === i ? { ...p, label: e.target.value || undefined } : p)))} placeholder="label" disabled={disabled} />
            <select
              value={inp.type ?? "string"}
              onChange={(e) => setInputs((prev) => prev.map((p, j) => (j === i ? { ...p, type: e.target.value } : p)))}
              className="bg-card text-foreground border border-border rounded-lg text-[13px] px-2 py-2"
              disabled={disabled}
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
            </select>
            <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <input type="checkbox" checked={Boolean(inp.required)} onChange={(e) => setInputs((prev) => prev.map((p, j) => (j === i ? { ...p, required: e.target.checked } : p)))} /> required
            </label>
            <Button variant="ghost" size="sm" onClick={() => setInputs((prev) => prev.filter((_, j) => j !== i))} disabled={disabled}>
              <Wrench size={12} />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setInputs((prev) => [...prev, { key: "", type: "string" }])} disabled={disabled} className="self-start">
          <Plus size={12} /> Add input field
        </Button>
      </div>
      {err && <Card className="p-2.5 text-[12px] text-rose-400 border-rose-500/30">{err}</Card>}
      <Button onClick={() => void submit()} disabled={disabled || busy} className="self-start">
        {busy ? <Spinner /> : <Bot size={14} />} Create agent node
      </Button>
    </div>
  );
}
