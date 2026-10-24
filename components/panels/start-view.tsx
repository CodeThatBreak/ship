"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, Braces, Play } from "lucide-react";
import type { FlowData, Node } from "../../app/flows/[id]/page";
import { parseStartContract, type StartContractField } from "../../lib/engine/nodes/start/contract";
import { Alert } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { PanelShell } from "./shared";
import { registerPanel } from "./registry";

/**
 * The flow entry panel (start node): the contract fields the flow starts
 * with, one form. Who provides the values follows the start node's trigger
 * type — auto flows publish the authored defaults (no form needed, the node
 * runs itself), manual/approval flows ask here when the user triggers, and a
 * webhook flow receives a payload validated against the same contract. Once
 * the node is done the published variables are listed — those are what the
 * next nodes map from.
 */
function StartView({ flow, node, action }: { flow: FlowData; node: Node; action: (a: string, b?: any) => Promise<void> | void }) {
  const fields = useMemo(() => parseStartContract(node.config ?? {}), [node.config]);
  const [values, setValues] = useState<Record<string, unknown>>(() => prefillStartValues(node, fields));
  const [submitting, setSubmitting] = useState(false);
  const pending = node.status === "pending";
  const failed = node.status === "failed";
  const done = node.status === "done" || node.status === "approved";
  const output = (node.output ?? {}) as Record<string, unknown>;

  const start = () => {
    setSubmitting(true);
    const input: Record<string, unknown> = {};
    for (const f of fields) {
      const v = values[f.key];
      if (v === undefined || v === null || v === "") continue;
      input[f.key] = v;
    }
    Promise.resolve(action("run_node", {
      nodeKey: node.node_key,
      input: fields.length ? input : undefined,
    })).finally(() => setSubmitting(false));
  };

  const setValue = (key: string, v: unknown) => setValues((cur) => ({ ...cur, [key]: v }));
  const canStart = pending && !submitting;

  const footer = (pending || failed) && (
    <>
      <span className="text-xs text-muted-foreground">
        {fields.length
          ? "Provide the contract values — the flow's nodes map from them."
          : "No contract declared — starting publishes nothing."}
      </span>
      <div className="flex-1" />
      <Button onClick={start} disabled={!canStart}>
        <Play size={14} /> {failed ? "Start again" : pending ? (fields.length ? "Provide values & start" : "Start flow") : "Started"}
      </Button>
    </>
  );

  return (
    <PanelShell node={node} action={action} flow={flow} hideFailed runningLabel="Starting the flow…" footer={footer}>
      {failed && (
        <Alert variant="destructive" className="mb-3.5">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="flex-1">
            The provided values didn&apos;t satisfy the start contract — fix them below and start again.
          </span>
        </Alert>
      )}
      {fields.length === 0 && (
        <p className="text-muted-foreground text-[13px] m-0">
          This flow&apos;s start node declares no contract — it finishes immediately and the branch
          trigger on it decides when the rest begins.
        </p>
      )}
      {fields.map((f) => (
        <StartFieldInput key={f.key} field={f} value={values[f.key]} onChange={(v) => setValue(f.key, v)} />
      ))}
      {done && (
        <section className="grid gap-2">
          <h3 className="text-[13px] font-semibold m-0 flex items-center gap-1.5">
            <Braces size={13} /> Published variables
          </h3>
          {Object.keys(output).length === 0 ? (
            <p className="text-muted-foreground text-[12.5px] m-0">No values were published.</p>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden text-[12.5px]">
              {Object.entries(output).map(([k, v]) => (
                <div key={k} className="flex items-start gap-2 px-3 py-1.5 border-b border-border last:border-0">
                  <code className="font-mono text-blue-400 shrink-0">{k}</code>
                  <span className="text-muted-foreground font-mono break-all">{fmtStartValue(v)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground m-0">
            The next nodes map from these — each pick resolves {`{{nodes.${node.node_key}.output.<field>}}`} at run time.
          </p>
        </section>
      )}
      {node.status === "running" && (
        <p className="text-muted-foreground text-[13px] m-0">Starting the flow…</p>
      )}
    </PanelShell>
  );
}

/** The form row for one start contract field (the engine coerces/validates). */
function StartFieldInput({
  field, value, onChange,
}: {
  field: StartContractField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2">
        <label className="text-[12.5px] font-medium">{field.label || field.key}</label>
        {field.label && <code className="font-mono text-[11px] text-muted-foreground">{field.key}</code>}
        <Badge variant="outline" className="text-[10px]">{field.type}</Badge>
        {field.required && <Badge className="bg-amber-500/10 text-amber-400 text-[10px]">required</Badge>}
      </div>
      {field.type === "boolean" ? (
        <label className="flex items-center gap-2 text-[13px] cursor-pointer">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <span className="text-muted-foreground text-[12px]">{field.label || field.key}</span>
        </label>
      ) : field.type === "object" || field.type === "array" ? (
        <Textarea
          value={text}
          rows={3}
          className="font-mono text-[12px]"
          placeholder={field.type === "array" ? "[ … ]" : "{ … }"}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input
          type={field.type === "number" ? "number" : "text"}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

/** Trigger form prefill: the last run's values win, then the authored defaults. */
function prefillStartValues(node: Node, fields: StartContractField[]): Record<string, unknown> {
  const recorded = (node.input && typeof node.input === "object" ? { ...(node.input as Record<string, unknown>) } : {});
  delete recorded.prompt;
  delete recorded.model;
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const r = recorded[f.key];
    out[f.key] = r !== undefined && r !== null ? r : (f.default !== undefined && f.default !== null ? f.default : "");
  }
  return out;
}

function fmtStartValue(v: unknown): string {
  if (typeof v === "string") return `"${v}"`;
  return JSON.stringify(v);
}

registerPanel({ type: "start" }, StartView);
