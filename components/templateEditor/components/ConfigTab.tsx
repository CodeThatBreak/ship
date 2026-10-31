"use client";
/**
 * The node configurator's Config tab: built-ins get the schema-driven config
 * form from their `configFields` (prompt fields excluded — the Prompt tab has
 * them); declarative kinds (agent / decision / http / script) edit instance
 * overrides through the shared DeclarativeConfigFields form. The fan-out
 * knobs stay gated behind the plan-downstream check and http nodes get the
 * {{secrets.NAME}} vocabulary read from the shared settings query.
 */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "../../ui/button";
import { Skeleton } from "../../ui/skeleton";
import { cn } from "@/lib/utils";
import { settingsQueryOptions } from "../../settings/queries";
import type { EditorNode, NodeContract } from "../types";
import {
  ConfigFieldRow,
  companionTextOf,
  freeTextFields,
  promptEditorKeys,
  writeConfig,
} from "../ConfigFieldRow";
import { DeclarativeConfigFields } from "../DeclarativeConfigFields";
import type { VarGroup } from "../variables";

import { FANOUT_FIELD_KEYS } from "@/constants/nodeKind";

/**
 * The Fanout gate's warning (§): the instance already overrides a fan-out key
 * but no plan node reaches it through next edges — the overrides are inert
 * (runtime falls back to the whole path) and save-time lint will flag them.
 * Shown above the gated fields so they stay visible to clear.
 */
function FanoutUnplannedHint() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/[0.04] px-3 py-2">
      <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warning" />
      <p className="text-[12px] text-warning/90 m-0">
        Fan-out needs a plan node upstream — these settings won&apos;t apply
        until a plan node flows into this node (save-time lint flags an
        unplanned fan-out). Clear the overrides or wire a plan in.
      </p>
    </div>
  );
}

export function ConfigTab({
  node,
  onChange,
  contract,
  varGroups,
  hasUpstream,
  planDownstream,
  invalidRefs,
  templateId,
}: {
  node: EditorNode;
  onChange: (p: Partial<EditorNode>) => void;
  contract: NodeContract | null;
  /** the grouped variable vocabulary — the pickers' single source (Phase 3) */
  varGroups: VarGroup[];
  /** any `next`-edge parent connected — false shows the inherit hint */
  hasUpstream: boolean;
  /** reachable from a plan node through next edges — the Fanout section gate */
  planDownstream?: boolean;
  /** live-linted refs → the linter's problem (underlined in prompt fields) */
  invalidRefs?: Record<string, string>;
  /** the owning template's id (Phase 5) — the expression editors' preview */
  templateId?: string;
}) {
  // http nodes (Phase 6): the configured secret names — read through the
  // shared settings query (names only; values never leave the server) and
  // offered as {{secrets.NAME}} chips under the fields where secrets resolve
  const isHttp = node.kind === "http";
  const secretsQuery = useQuery({
    ...settingsQueryOptions(),
    enabled: isHttp,
  });
  const secretNames = secretsQuery.data?.secrets ?? null;
  // the read failed — surface it with a retry (otherwise the chips just
  // vanish) — rendered in both the declarative and builtin branches
  const secretsError = isHttp && secretsQuery.isError ? (
    <p className="text-[11px] text-destructive m-0 flex items-center gap-2">
      Couldn&apos;t load the configured secrets.
      <Button
        variant="outline"
        size="xs"
        onClick={() => void secretsQuery.refetch()}
      >
        <RefreshCw size={12} /> Retry
      </Button>
    </p>
  ) : null;

  // no upstream yet (unconnected node or an entry): the inherit hint
  const inheritHint = !hasUpstream ? (
    <p className="text-[11px] text-muted-foreground m-0">
      Connect a node to inherit its outputs as variables.
    </p>
  ) : null;
  // the fan-out gate (save-time lint rule 1, mirrored for the editor): the
  // shared Fanout fields render only for plan-downstream nodes. Gated off
  // while unqualified — unless the instance already overrides one (the stale
  // config must stay visible so the author can clear it) with a warning hint.
  const fanoutConfigured = [...FANOUT_FIELD_KEYS].some((k) => node.config?.[k] != null);
  const showFanout = planDownstream || fanoutConfigured;
  const fanoutHint = !planDownstream && fanoutConfigured ? <FanoutUnplannedHint /> : null;
  // declarative kinds: the catalog definition IS the config — the shared
  // DeclarativeConfigFields form (also the Template Nodes create dialog's)
  // renders every knob the kind declares; values set here override the
  // catalog definition for this template instance
  if (!node.is_builtin) {
    return (
      <div className="grid gap-3">
        {inheritHint}
        {secretsError}
        {fanoutHint}
        <DeclarativeConfigFields
          key={`${node.key}:${node.nodeTemplateId}`}
          kind={node.kind ?? ""}
          config={node.config ?? {}}
          contract={contract}
          secretNames={secretNames}
          varGroups={varGroups}
          invalidRefs={invalidRefs}
          templateId={templateId}
          planDownstream={planDownstream}
          hideFields={promptEditorKeys}
          onConfigChange={(config) => onChange({ config })}
        />
      </div>
    );
  }
  const fields = contract?.config?.fields ?? [];
  // the class/catalog defaults (from the contract) — shown in place when a
  // knob has no override (e.g. the MCP sources field shows the node's
  // all-sources default checked before anything was picked)
  const defaults = (contract?.config?.defaults ?? {}) as Record<string, unknown>;
  // the prompt fields moved to the dedicated Prompt tab
  const nonPromptFields = fields.filter((f) => !promptEditorKeys.has(f.key));
  return (
    <div className="grid gap-3">
      {inheritHint}
      {secretsError}
      {fanoutHint}
      {nonPromptFields.length === 0 && !contract && <ConfigFieldsSkeleton />}
      {nonPromptFields.length === 0 && contract && (
        <p className="text-muted-foreground text-[13px]">
          {fields.length > 0
            ? "Everything configurable here lives on the Prompt tab."
            : "This node has no configurability."}
        </p>
      )}
      {nonPromptFields
        .filter((f) => !FANOUT_FIELD_KEYS.has(f.key) || showFanout)
        .map((f) => (
        <ConfigFieldRow
          key={`${node.key}:${f.key}`}
          field={f}
          value={node.config?.[f.key]}
          defaultValue={defaults[f.key]}
          companionText={companionTextOf(node.config, f.key)}
          varGroups={freeTextFields.has(f.key) ? varGroups : undefined}
          invalidRefs={invalidRefs}
          templateId={templateId}
          onChange={(v, extra) =>
            onChange({ config: writeConfig(node.config, f.key, v, extra) })
          }
        />
      ))}
    </div>
  );
}

/** The Config tab's loading skeleton: the ConfigFieldRow field shape. */
function ConfigFieldsSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="grid gap-1.5">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className={cn("w-full rounded-lg", i === 2 ? "h-9" : "h-[102px]")} />
        </div>
      ))}
    </div>
  );
}
