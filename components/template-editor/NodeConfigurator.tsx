"use client";
import { useEffect, useMemo, useState } from "react";
import { ListChecks, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { cn } from "../../lib/utils";
import { GENERIC_TRIGGER_HELP, TRIGGER_TYPES, WAIT_FOR_SOURCES } from "./constants";
import type { EditorNode, NodeContract } from "./types";

/**
 * The node configurator dialog (§8): Trigger / Config / Contract tabs.
 * Built-ins get the schema-driven config form from their `configFields`;
 * declarative (agent) nodes edit the instance overrides (prompt body, mode,
 * model) and show the declared contract read-only.
 */
export default function NodeConfigurator({
  open, node, onClose, onChange,
}: {
  open: boolean;
  node: EditorNode | null;
  onClose: () => void;
  onChange: (patch: Partial<EditorNode>) => void;
}) {
  const [tab, setTab] = useState<"trigger" | "config" | "contract">("trigger");
  const [contract, setContract] = useState<NodeContract | null>(null);

  // reset per node + load the contract from the registry / declarative def
  useEffect(() => {
    setTab("trigger");
    setContract(null);
  }, [node?.nodeTemplateId, node?.key, open]);

  useEffect(() => {
    if (!open || !node || contract != null) return;
    fetch(`/api/contracts?def=${encodeURIComponent(node.nodeTemplateId)}`)
      .then((r) => r.json())
      .then((c: any) => {
        if (c && c.input != null) setContract(c as NodeContract);
        else {
          // unknown kind (Phase 3) — an empty contract keeps the tabs usable
          setContract({ key: node.nodeTemplateId, label: node.catalog_name ?? node.key, kind: node.kind ?? "", input: null, output: null, config: { fields: [], defaults: {} } });
        }
      })
      .catch(() => {});
  }, [open, node, contract]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[680px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={14} className="text-muted-foreground" />
            {node ? `${node.overrideLabel ?? node.catalog_name ?? node.key}` : "Node"}
            <Badge variant="outline">{node?.kind ?? "builtin"}</Badge>
          </DialogTitle>
        </DialogHeader>

        {/* tabs */}
        <div className="flex gap-1 border-b border-border -mx-2 px-2">
          {(["trigger", "config", "contract"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-3 py-1.5 text-[12.5px] font-medium border-b-[1.5px] -mb-px capitalize",
                tab === t ? "text-foreground border-blue-500" : "text-muted-foreground border-transparent hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {!node ? null : tab === "trigger" ? (
          <TriggerTab node={node} onChange={onChange} />
        ) : tab === "config" ? (
          <ConfigTab node={node} onChange={onChange} contract={contract} />
        ) : (
          <ContractView contract={contract} node={node} />
        )}

        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TriggerTab({ node, onChange }: { node: EditorNode; onChange: (p: Partial<EditorNode>) => void }) {
  const t = node.trigger;
  return (
    <div className="grid gap-3">
      <p className="text-[12px] text-muted-foreground m-0">{GENERIC_TRIGGER_HELP}</p>
      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground">Trigger type</label>
        <select
          value={t.type}
          onChange={(e) => onChange({ trigger: { ...t, type: e.target.value } })}
          className="bg-card text-foreground border border-border rounded-lg text-[13px] px-3 py-2"
        >
          {Object.entries(TRIGGER_TYPES).map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
      </div>
      {t.type === "debounced" && (
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">Quiet period (minutes)</label>
          <Input
            type="number"
            min={0}
            value={t.minutes ?? 10}
            onChange={(e) => onChange({ trigger: { ...t, minutes: Number(e.target.value) || 0 } })}
          />
        </div>
      )}
      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground">Wait for event</label>
        <select
          value={t.wait_for ?? ""}
          onChange={(e) => onChange({ trigger: { ...t, wait_for: e.target.value || undefined } })}
          className="bg-card text-foreground border border-border rounded-lg text-[13px] px-3 py-2"
        >
          <option value="">— nothing (proceed when joins are met)</option>
          {WAIT_FOR_SOURCES.map((w) => (
            <option key={w.value} value={w.value}>{w.label}</option>
          ))}
          <option value="" disabled>webhook / timer — Phase 4</option>
        </select>
      </div>
    </div>
  );
}

function ConfigTab({
  node, onChange, contract,
}: {
  node: EditorNode;
  onChange: (p: Partial<EditorNode>) => void;
  contract: NodeContract | null;
}) {
  if (node.is_builtin) {
    const fields = contract?.config?.fields ?? [];
    return (
      <div className="grid gap-3">
        {fields.length === 0 && !contract && <p className="text-muted-foreground text-[13px]"><Spinner /> Loading schema…</p>}
        {fields.length === 0 && contract && <p className="text-muted-foreground text-[13px]">This node has no configurability.</p>}
        {fields.map((f) => (
          <ConfigFieldRow
            key={f.key}
            field={f}
            value={node.config?.[f.key]}
            onChange={(v) => onChange({ config: { ...node.config, [f.key]: v } })}
          />
        ))}
        <p className="text-[11px] text-muted-foreground m-0">
          Empty fields use the class defaults (zero-behavior-change guarantee); app settings overlay these.
        </p>
      </div>
    );
  }
  // declarative (agent) instance config — overrides on this template instance
  const cfg = node.config ?? {};
  return (
    <div className="grid gap-3">
      <p className="text-[12px] text-muted-foreground m-0">
        These override the node&apos;s catalog definition for <strong>this template instance</strong> only.
      </p>
      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground">Prompt body</label>
        <Textarea
          value={typeof cfg.prompt === "string" ? cfg.prompt : ""}
          onChange={(e) => onChange({ config: { ...cfg, prompt: e.target.value } })}
          rows={8}
          className="font-mono text-[12px]"
          placeholder="Leave empty to use the catalog definition's prompt. Variables: {{ticket.*}}, {{flow.*}}, {{repo.*}}, {{nodes.<key>.output.*}}"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">Mode</label>
          <select
            value={typeof cfg.mode === "string" ? cfg.mode : "plan"}
            onChange={(e) => onChange({ config: { ...cfg, mode: e.target.value } })}
            className="bg-card text-foreground border border-border rounded-lg text-[13px] px-3 py-2"
          >
            <option value="plan">plan (read-only)</option>
            <option value="agent">agent (repo workspace)</option>
          </select>
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">Model</label>
          <Input
            value={typeof cfg.model === "string" ? cfg.model : ""}
            onChange={(e) => onChange({ config: { ...cfg, model: e.target.value || null } })}
            placeholder="flow default"
          />
        </div>
      </div>
      {typeof cfg.prompt !== "string" && <Card className="p-2.5 text-[11.5px] text-muted-foreground">Catalog definition prompt in effect</Card>}
    </div>
  );
}

function ConfigFieldRow({
  field, value, onChange,
}: {
  field: { key: string; label: string; type: string; help?: string; options?: { value: string; label: string }[] };
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (field.type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-[13px] cursor-pointer">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        <span>{field.label}</span>
        {field.help && <span className="text-[11px] text-muted-foreground">— {field.help}</span>}
      </label>
    );
  }
  return (
    <div className="grid gap-1">
      <label className="text-xs text-muted-foreground">{field.label}</label>
      {field.type === "select" ? (
        <select
          value={value != null && Object.keys(field.options ?? []).includes(String(value)) ? String(value) : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="bg-card text-foreground border border-border rounded-lg text-[13px] px-3 py-2"
        >
          <option value="">— default</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : field.type === "text" || field.type === "string" ? (
        <Textarea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          rows={field.type === "text" ? 5 : 1}
          className="font-mono text-[12px]"
          placeholder="(default)"
        />
      ) : (
        <Input type="number" value={typeof value === "number" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} placeholder="(default)" />
      )}
      {field.help && field.type !== "boolean" && <p className="text-[11px] text-muted-foreground m-0">{field.help}</p>}
    </div>
  );
}

function ContractView({ contract, node }: { contract: NodeContract | null; node: EditorNode }) {
  if (!contract) return <p className="text-muted-foreground text-[13px]"><Spinner /> Loading contract…</p>;
  const rows = schemaRows(contract.output);
  const inputRows = schemaRows(contract.input);
  return (
    <div className="grid gap-4">
      <section>
        <h4 className="text-[12.5px] font-medium mb-1.5 flex items-center gap-1.5"><ListChecks size={13} /> Inputs — what this node needs</h4>
        <ContractTable rows={inputRows} empty="No declared inputs (input mapping evaluates in Phase 3)." />
      </section>
      <section>
        <h4 className="text-[12.5px] font-medium mb-1.5 flex items-center gap-1.5"><ListChecks size={13} /> Outputs — published to the flow</h4>
        <ContractTable rows={rows} empty="No declared output fields." />
        {contract.output && contract.output.type === "object" && contract.output.properties?.markdown === undefined && (
          <p className="text-[11px] text-muted-foreground mt-1.5 m-0">Addressed downstream as <code className="font-mono">{"{{nodes." + node.key + ".output.<field>}}"}</code></p>
        )}
      </section>
    </div>
  );
}

function ContractTable({ rows, empty }: { rows: { name: string; type: string; required: boolean }[]; empty: string }) {
  if (!rows.length) return <p className="text-[12px] text-muted-foreground m-0">{empty}</p>;
  return (
    <div className="border border-border rounded-lg overflow-hidden text-[12.5px]">
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2 px-3 py-1.5 border-b border-border last:border-0">
          <code className="font-mono text-blue-400">{r.name}</code>
          <Badge variant="outline" className="text-[10px]">{r.type}</Badge>
          {r.required && <Badge className="bg-amber-500/10 text-amber-400 text-[10px]">required</Badge>}
        </div>
      ))}
    </div>
  );
}

function schemaRows(schema: any): { name: string; type: string; required: boolean }[] {
  if (!schema || schema.type !== "object" || !schema.properties) return [];
  const required: string[] = schema.required ?? [];
  return Object.entries(schema.properties as Record<string, any>).map(([name, s]) => ({
    name,
    type: Array.isArray(s?.type) ? s.type.join("|") : (s?.type ?? (s?.enum ? "enum" : "any")),
    required: required.includes(name),
  }));
}
