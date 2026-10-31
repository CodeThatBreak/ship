/**
 * The edge configurator drawer (§8): From/To node pickers, the edge's kind
 * (next / loop), the decision-branch label (quick-picked from the source
 * decision's contract choices) and the JSONata condition that gates when the
 * edge activates. Presentational + its own contract fetch; the parent owns
 * the draft mutation through `onChange` patches. The field block lives in
 * `components/`.
 */
import { useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import { Field, FieldLabel } from "../ui/field";
import { useNodeContract } from "./hooks/use-node-contract";
import { EdgeSelect } from "./components/EdgeSelect";
import { EdgeKindField } from "./components/EdgeKindField";
import { EdgeLabelField } from "./components/EdgeLabelField";
import { EdgeConditionField } from "./components/EdgeConditionField";
import type { EditorEdge, EditorNode } from "./types";
import { nodeLabel } from "./types";
import { isDuplicateTemplateEdge } from "./utils/graph-edges";
import {
  asJsonataGroups,
  buildVarGroups,
  conditionVarGroups,
  schemaRows,
} from "./variables";

export function EdgeEditor({
  edge,
  edges,
  edgeIndex,
  nodes,
  readonly,
  onChange,
  sourceNode,
  templateId,
  taskFields,
  triggerFields,
}: {
  edge: EditorEdge;
  /** the draft edge list — dedupe/self-edge filtering for From/To pickers */
  edges: EditorEdge[];
  edgeIndex: number;
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
  // the source node's contract (Phase 2 data layer): a decision source means
  // the edge label must be one of its choices — quick-picked; any source's
  // published fields become the nodes.<key>.output.* paths the condition
  // builder offers (the source node is finished when it's traversed).
  const contractQuery = useNodeContract(sourceNode);
  const contract = contractQuery.data ?? null;

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

  const fromOptions = useMemo(
    () =>
      nodes.filter(
        (n) =>
          n.key !== edge.to &&
          !isDuplicateTemplateEdge(edges, n.key, edge.to, edge.label, edgeIndex),
      ),
    [nodes, edges, edge.to, edge.label, edgeIndex],
  );

  const toOptions = useMemo(
    () =>
      nodes.filter(
        (n) =>
          n.key !== edge.from &&
          !isDuplicateTemplateEdge(edges, edge.from, n.key, edge.label, edgeIndex),
      ),
    [nodes, edges, edge.from, edge.label, edgeIndex],
  );

  const patchFrom = (from: string) => {
    const patch: Partial<EditorEdge> = { from };
    if (from !== edge.from) {
      patch.label = null;
      patch.condition = null;
    }
    onChange(patch);
  };

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel>From</FieldLabel>
          <EdgeSelect
            value={edge.from}
            nodes={fromOptions}
            disabled={readonly}
            onChange={patchFrom}
          />
        </Field>
        <Field>
          <FieldLabel>To</FieldLabel>
          <EdgeSelect
            value={edge.to}
            nodes={toOptions}
            disabled={readonly}
            onChange={(v) => onChange({ to: v })}
          />
        </Field>
      </div>
      {/* the contract read failed — a silent failure would drop the source's
          outputs from the condition vocabulary; surface it with a retry */}
      {sourceNode && contractQuery.isError && (
        <div className="flex items-center gap-2">
          <p className="text-[11px] text-destructive m-0">
            Couldn&apos;t load the source node&apos;s contract — its outputs
            are missing from the condition vocabulary.
          </p>
          <Button
            variant="outline"
            size="xs"
            className="shrink-0"
            onClick={() => void contractQuery.refetch()}
          >
            <RefreshCw size={11} /> Retry
          </Button>
        </div>
      )}
      <EdgeKindField
        kind={edge.kind}
        readonly={readonly}
        onKindChange={(kind) => onChange({ kind })}
      />
      <EdgeLabelField
        label={edge.label}
        decision={isDecision}
        choices={isDecision ? contract?.choices ?? null : null}
        readonly={readonly}
        onLabelChange={(label) => onChange({ label })}
      />
      <EdgeConditionField
        condition={edge.condition}
        varGroups={condGroups}
        templateId={templateId}
        readonly={readonly}
        onConditionChange={(raw) => onChange({ condition: raw })}
      />
    </div>
  );
}
