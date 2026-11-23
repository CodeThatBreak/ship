"use client";
/**
 * The node configurator's Config tab: built-ins get the schema-driven config
 * form from their `configFields` (prompt fields excluded — the Prompt tab has
 * them); declarative kinds (agent / decision / http / script) edit instance
 * overrides through the shared DeclarativeConfigFields form. Http nodes get
 * the {{secrets.NAME}} vocabulary read from the shared settings query.
 */
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from '../../../../ui/button';
import { Skeleton } from '../../../../ui/skeleton';
import { cn } from "@/lib/utils";
import { settingsQueryOptions } from '../../../../settings/queries';
import type { EditorNode, NodeContract } from '../../../types';
import { ConfigFieldRow } from './fields/components/ConfigFieldRow';
import {
  companionTextOf,
  freeTextFields,
  promptEditorKeys,
  secretRefFields,
  writeConfig,
} from '../../../configFieldLogic';
import { DeclarativeConfigFields } from './fields/DeclarativeConfigFields';
import type { VarGroup } from '../../../variables';

export function ConfigTab({
  node,
  onChange,
  contract,
  varGroups,
  hasUpstream,
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
  /** live-linted refs → the linter's problem (underlined in prompt fields) */
  invalidRefs?: Record<string, string>;
  /** the owning template's id (Phase 5) — the expression editors' preview */
  templateId?: string;
}) {
  // http nodes (Phase 6): the configured secret names — read through the
  // shared settings query (names only; values never leave the server) and
  // offered as {{secrets.NAME}} chips under the fields where secrets resolve.
  // Task 15: declarative knobs whose options ARE the secret names (the agent
  // kind's `secret_refs`) read the same list.
  const isHttp = node.kind === "http";
  const needsSecretNames =
    isHttp || (contract?.config?.fields ?? []).some((f) => secretRefFields.has(f.key));
  const secretsQuery = useQuery({
    ...settingsQueryOptions(),
    enabled: needsSecretNames,
  });
  const secretNames = needsSecretNames ? (secretsQuery.data?.secrets ?? null) : null;
  // the read failed — surface it with a retry (otherwise the chips/options just
  // vanish) — rendered in both the declarative and builtin branches
  const secretsError = needsSecretNames && secretsQuery.isError ? (
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
  // declarative kinds: the catalog definition IS the config — the shared
  // DeclarativeConfigFields form (also the Template Nodes create dialog's)
  // renders every knob the kind declares; values set here override the
  // catalog definition for this template instance
  if (!node.isBuiltin) {
    return (
      <div className="grid gap-3">
        {inheritHint}
        {secretsError}
        <DeclarativeConfigFields
          key={`${node.key}:${node.nodeTemplateId}`}
          kind={node.kind ?? ""}
          config={node.config ?? {}}
          contract={contract}
          secretNames={secretNames}
          varGroups={varGroups}
          invalidRefs={invalidRefs}
          templateId={templateId}
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
      {nonPromptFields.length === 0 && !contract && <ConfigFieldsSkeleton />}
      {nonPromptFields.length === 0 && contract && (
        <p className="text-muted-foreground text-[13px]">
          {fields.length > 0
            ? "Everything configurable here lives on the Prompt tab."
            : "This node has no configurability."}
        </p>
      )}
      {nonPromptFields.map((f) => (
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
