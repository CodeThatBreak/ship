/**
 * The edge configurator drawer (§8): From/To node pickers, the edge's kind
 * (next / loop), the decision-branch label (quick-picked from the source
 * decision's contract choices) and the JSONata condition that gates when the
 * edge activates. Presentational + its own contract fetch; the parent owns
 * the draft mutation through `onChange` patches.
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { cn } from "../../lib/utils";
import { ConditionBuilder } from "./ConditionBuilder";
import { SelectOption } from "./NodeConfigurator";
import type {
  EditorEdge,
  EditorNode,
  NodeContract,
} from "./types";
import {
  contractsUrl,
  nodeLabel,
} from "./types";
import {
  asJsonataGroups,
  buildVarGroups,
  conditionVarGroups,
  schemaRows,
} from "./variables";

/** The edge kinds the editor can author (the stored values stay these strings). */
const EDGE_KINDS = ["next", "loop"] as const;

/** Edge kinds as labeled options (the kind select's friendly labels). */
const EDGE_KIND_OPTIONS: Record<string, { label: string; description: string }> = {
  next: {
    label: "Next",
    description:
      "Runs the target after the source finishes; its output joins the target's input.",
  },
  loop: {
    label: "Loop",
    description:
      "Runs the target again after it finishes, up to the target's retry limit.",
  },
};

export function EdgeEditor({
  edge,
  nodes,
  readonly,
  onChange,
  sourceNode,
  templateId,
  taskFields,
  triggerFields,
}: {
  edge: EditorEdge;
  /** the draft graph's instances — the From/To pickers' options */
  nodes: EditorNode[];
  readonly: boolean;
  onChange: (patch: Partial<EditorEdge>) => void;
  sourceNode: EditorNode | null;
  /** the owning template's id (Phase 5) — the condition's live preview */
  templateId: string;
  /** the {{task.*}} / {{trigger.payload.*}} vocabulary (Phase 3) — the
   *  condition builder's variable lists (an edge condition sees the whole
   *  flow context, not just the source node's output) */
  taskFields: { key: string; label?: string; type?: string }[];
  triggerFields: { key: string; label?: string; type?: string }[];
}) {
  const isDecision = sourceNode?.kind === "decision";
  // decision sources: the edge label must be one of the decision's choices —
  // quick-picks from the contract. Non-decision sources: the contract still
  // resolves — its published fields are the nodes.<key>.output.* paths the
  // condition builder offers (the source node is finished when it's traversed).
  const [contract, setContract] = useState<NodeContract | null>(null);
  useEffect(() => {
    if (!sourceNode) {
      setContract(null);
      return;
    }
    let alive = true;
    fetch(contractsUrl(sourceNode))
      .then((r) => r.json())
      .then((c: NodeContract) => {
        if (alive) setContract(c?.input != null ? c : null);
      })
      .catch(() => alive && setContract(null));
    return () => {
      alive = false;
    };
  }, [
    sourceNode?.key,
    sourceNode?.nodeTemplateId,
    sourceNode?.config,
    sourceNode?.kind,
  ]);

  // the condition's vocabulary: task context → the source node's published
  // outputs → trigger payload → flow & repo (no "my inputs" — the context map
  // has no input root at edge-traversal time)
  const condGroups = useMemo(() => {
    const upstream = sourceNode
      ? [
          {
            key: sourceNode.key,
            label: nodeLabel(sourceNode),
            fields: schemaRows(contract?.output ?? null).map((f) => ({
              name: f.name,
              type: f.type,
            })),
          },
        ]
      : [];
    return asJsonataGroups(
      conditionVarGroups(
        buildVarGroups({ taskFields, triggerFields, upstream }),
      ),
    );
  }, [sourceNode, contract, taskFields, triggerFields]);
  const choices = isDecision
    ? ((
        contract as
          | (NodeContract & {
              choices?: { label: string; description?: string }[];
            })
          | null
      )?.choices ?? [])
    : null;

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label>From</Label>
          <EdgeSelect
            value={edge.from}
            nodes={nodes}
            disabled={readonly}
            onChange={(v) => onChange({ from: v })}
          />
        </div>
        <div className="grid gap-1">
          <Label>To</Label>
          <EdgeSelect
            value={edge.to}
            nodes={nodes}
            disabled={readonly}
            onChange={(v) => onChange({ to: v })}
          />
        </div>
      </div>
      <div className="grid gap-1">
        <Label>Kind</Label>
        <Select
          value={edge.kind}
          disabled={readonly}
          onValueChange={(v) => {
            if (v != null) onChange({ kind: v });
          }}
        >
          <SelectTrigger className="w-full rounded-lg border-border bg-card">
            <SelectValue>
              {EDGE_KIND_OPTIONS[edge.kind]?.label ?? edge.kind}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {EDGE_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                <SelectOption
                  label={EDGE_KIND_OPTIONS[k]?.label ?? k}
                  description={EDGE_KIND_OPTIONS[k]?.description ?? ""}
                />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground m-0">
          {edge.kind === "loop"
            ? "A loop edge runs the target again after it finishes, up to the target's retry limit."
            : "Runs the target when the source finishes."}
        </p>
      </div>
      <div className="grid gap-1">
        <Label>
          Label{" "}
          {isDecision && (
            <span className="text-warning">
              — required for decision branches
            </span>
          )}
        </Label>
        {isDecision && choices && choices.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {choices.map((c) => (
              <Button
                key={c.label}
                disabled={readonly}
                title={c.description}
                onClick={() => onChange({ label: c.label })}
                variant="outline"
                size="xs"
                className={cn(
                  "rounded-md text-[11.5px]",
                  edge.label === c.label
                    ? "border-violet-500 bg-violet-500/10 text-violet-300"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {c.label}
              </Button>
            ))}
          </div>
        )}
        <Input
          value={edge.label ?? ""}
          placeholder={
            isDecision
              ? "a choice of the decision node"
              : "label (decision branch)"
          }
          disabled={readonly}
          onChange={(ev) => onChange({ label: ev.target.value || null })}
        />
      </div>
      <div className="grid gap-1.5">
        <label className="text-xs text-muted-foreground">
          Condition — when does this edge activate?
        </label>
        <ConditionBuilder
          value={edge.condition}
          varGroups={condGroups}
          templateId={templateId}
          scope="context"
          placeholder="nodes.build.output.mr_url"
          disabled={readonly}
          onChange={(raw) => onChange({ condition: raw })}
        />
        <p className="text-[11px] text-muted-foreground m-0">
          The edge runs only when its condition passes — leave it empty to
          always run. It&apos;s checked against the flow&apos;s context as the
          source node finishes.
        </p>
      </div>
    </div>
  );
}

function EdgeSelect({
  value,
  nodes,
  disabled,
  onChange,
}: {
  value: string;
  nodes: EditorNode[];
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const selected = nodes.find((n) => n.key === value);
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(v) => {
        if (v != null) onChange(v);
      }}
    >
      <SelectTrigger className="w-full rounded-lg border-border bg-card font-mono">
        <SelectValue>{selected ? nodeLabel(selected) : value}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {nodes.map((n) => (
          <SelectItem key={n.key} value={n.key} className="font-mono">
            {nodeLabel(n)}
            {n.key !== nodeLabel(n) && (
              <span className="text-muted-foreground"> ({n.key})</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
