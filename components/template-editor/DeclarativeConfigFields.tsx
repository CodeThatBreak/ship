"use client";
/**
 * A declarative kind's full definition form (§8): every knob the runtime
 * class declares (`configFields`, delivered via /api/contracts) rendered
 * with the same editors the builder drawer uses — so "configure everything"
 * is one surface, not a trimmed create-dialog copy that silently drops
 * fields (model, output schemas, headers, timeouts, response maps, …).
 *
 * Host-agnostic: values write straight through to the given config object —
 * the persisted `node_templates` definition on the Template Nodes page, the
 * instance override in the builder drawer. Field gating mirrors ConfigTab:
 * the agent's output schema only matters for json output, the decision's
 * prompt only for the agent source, and the fan-out knobs only show when a
 * plan node is upstream (or an override already exists, so it stays clearable).
 */
import { Spinner } from "../ui/spinner";
import type { NodeContract } from "./types";
import {
  ConfigFieldRow,
  companionTextOf,
  freeTextFields,
  secretFields,
  writeConfig,
} from "./ConfigFieldRow";
import { httpResponseVarGroups, type VarGroup } from "./variables";

export interface DeclarativeConfigFieldsProps {
  /** the declarative kind (agent / decision / http / script) */
  kind: string;
  /** the config being edited (the definition or the instance override) */
  config: Record<string, unknown>;
  /** the kind's contract — `/api/contracts?kind=…` (fields + defaults) */
  contract: NodeContract | null;
  /** configured secret names — http nodes' {{secrets.NAME}} chip groups */
  secretNames?: string[] | null;
  /** the variable vocabulary for the prompt/variables pickers */
  varGroups?: VarGroup[];
  /** live-linted refs → problem (prompt fields underline them; drawer only) */
  invalidRefs?: Record<string, string>;
  /** the owning template's id — the expression editors' live preview */
  templateId?: string;
  /** reachable from a plan node through next edges — the Fanout gate */
  planDownstream?: boolean;
  /** writes the whole next config object */
  onConfigChange: (config: Record<string, unknown>) => void;
}

export function DeclarativeConfigFields({
  kind,
  config,
  contract,
  secretNames = null,
  varGroups,
  invalidRefs,
  templateId,
  planDownstream,
  onConfigChange,
}: DeclarativeConfigFieldsProps) {
  const fields = contract?.config?.fields ?? [];
  const defaults = (contract?.config?.defaults ?? {}) as Record<string, unknown>;
  if (!contract) {
    return (
      <p className="text-muted-foreground text-[13px]">
        <Spinner /> Loading schema…
      </p>
    );
  }
  if (!fields.length) {
    return (
      <p className="text-muted-foreground text-[13px]">
        This node has no configurability.
      </p>
    );
  }
  // the agent's output schema only matters when the output format is json —
  // an override output wins over the catalog default
  const agentOutputJson =
    kind === "agent" && (config.output ?? defaults.output) === "json";
  // the decision's source picks its fields: the prompt only matters for the
  // agent source, and the single global expression field is superseded by the
  // per-choice conditions edited inside the choices editor
  const decisionSource =
    kind === "decision"
      ? String(config.source ?? defaults.source ?? "manual")
      : undefined;
  // the fan-out gate (save-time lint rule 1, mirrored for the editor): the
  // shared Fanout fields render only for plan-downstream nodes. Gated off
  // while unqualified — unless the instance already overrides one (the stale
  // config must stay visible so the author can clear it) with a warning hint.
  const fanoutKeys = new Set(["fanout_mode", "fanout_child", "fanout_parallel_max"]);
  const fanoutConfigured = [...fanoutKeys].some((k) => config[k] != null);
  const showFanout = planDownstream || fanoutConfigured;
  const isHttp = kind === "http";
  return (
    <div className="grid gap-3">
      {fields
        .filter(
          (f) =>
            !(f.key === "output_schema" && kind === "agent") ||
            agentOutputJson ||
            config.output_schema != null,
        )
        .filter((f) => !(kind === "decision" && f.key === "expression"))
        .filter(
          (f) =>
            !(kind === "decision" && f.key === "question") ||
            decisionSource === "agent",
        )
        .filter((f) => !fanoutKeys.has(f.key) || showFanout)
        .map((f) => (
          <ConfigFieldRow
            key={f.key}
            field={f}
            value={config[f.key]}
            defaultValue={defaults[f.key]}
            companionText={companionTextOf(config, f.key, defaults[f.key])}
            decisionSource={decisionSource}
            secrets={isHttp && secretFields.has(f.key) ? secretNames ?? undefined : undefined}
            varGroups={
              f.key === "response_map"
                ? httpResponseVarGroups()
                : freeTextFields.has(f.key) || f.type === "choices" || f.type === "map"
                  ? varGroups
                  : undefined
            }
            invalidRefs={invalidRefs}
            templateId={templateId}
            onChange={(v, extra) =>
              onConfigChange(writeConfig(config, f.key, v, extra))
            }
          />
        ))}
    </div>
  );
}
