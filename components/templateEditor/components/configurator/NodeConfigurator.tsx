"use client";
import { useCallback, useMemo } from "react";
import { AlertTriangle, RefreshCw, Unplug } from "lucide-react";
import { Button } from '../../../ui/button';
import { ScrollArea } from '../../../ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '../../../ui/tabs';
import type { EditorNode, EditorNodePatch } from '../../types';
import {
  NEXT_EDGE_KIND,
  useUpstreamGroups,
  type IncomingLink,
} from '../../hooks/useUpstreamGroups';
import { useNodeContractView } from '../../hooks/useNodeContractView';
import { TAB_LABELS, useConfiguratorTabs } from '../../hooks/useConfiguratorTabs';
import { buildVarGroups } from '../../variables';
import { InputsTab } from "./InputsTab";
import { PromptTab } from "./PromptTab";
import { TriggerTab } from './TriggerTab';
import { ConfigTab } from './ConfigTab';
import { StartContractEditor } from './contract/StartContractEditor';
import { ContractView } from './contract/ContractView';

export type { IncomingLink, UpstreamGroup } from '../../hooks/useUpstreamGroups';

/**
 * The node configurator (§8): Trigger / Inputs / Config / Inputs & outputs
 * tabs ("Start fields" replaces the start node's Config/Contract tabs — its
 * fields ARE the contract). Built-ins get the schema-driven config form from
 * their `configFields`; declarative kinds (agent / decision / http / script)
 * edit instance overrides through the same schema-driven form (their runtime
 * classes declare `configFields`). The Inputs tab (Phase 4) makes the node's
 * effective input visible and mappable: inherited rows from the connected
 * parents' published outputs, plus `input_map` mappings (the engine's
 * §3 overlay). The Inputs & outputs tab shows the per-source upstream inputs
 * and the node's own published outputs.
 *
 * The tabbed body is exported for any host surface — the visual builder
 * (Phase 5) embeds it in a node drawer. The tabs render from their own
 * components (`./components/`) and the data layer lives in the feature hooks
 * (`./hooks/`).
 */
export function NodeConfiguratorBody({
  node,
  onChange,
  incoming,
  locked,
  planDownstream,
  taskFields,
  triggerFields,
  invalidRefs,
  templateId,
  problems,
  registerPendingFlush,
  readOnly = false,
}: {
  node: EditorNode;
  onChange: (patch: EditorNodePatch) => void;
  /** Incoming edges + sources (visual builder) — drives the variable groups
   *  (the connected upstream nodes' published outputs). */
  incoming?: IncomingLink[];
  /** Node has no edges at all — shows a connect hint above the form; the
   *  prompt/knobs stay editable (task context variables remain available). */
  locked?: boolean;
  /** The node is reachable from a plan node through next edges (the host
   *  computes it over the whole template graph) — the Fanout config section
   *  only applies here; an unplanned fan-out would fail save-time lint
   *  rule 1 and silently runs whole at runtime. */
  planDownstream?: boolean;
  /** The template's declared task type's contextFields (Phase 3) — the
   *  {{task.*}} vocabulary offered on EVERY node (base context, no wiring). */
  taskFields?: { key: string; label: string; type: string; required?: boolean }[];
  /** The template's start node's contract fields (Phase 3) — the
   *  {{trigger.payload.*}} vocabulary (what the flow starts with). */
  triggerFields?: { key: string; label?: string; type?: string }[];
  /** Live-linted refs for THIS node (Phase 3): ref → the linter's problem.
   *  The prompt editor underlines the invalid ones where they're typed. */
  invalidRefs?: Record<string, string>;
  /** The owning template's id (Phase 5) — powers the expression editors'
   *  live preview (the value evaluated against the most recent run). */
  templateId?: string;
  /** The static linter's problems for THIS node (Phase 5) — shown as a list
   *  above the tabs (the prompt fields underline their refs inline too). */
  problems?: string[];
  registerPendingFlush?: (flush: () => void) => () => void;
  /** Built-in templates: configurator fields are view-only (CR-134). */
  readOnly?: boolean;
}) {
  const emitChange = useCallback(
    (patch: EditorNodePatch) => {
      if (readOnly) return;
      onChange(patch);
    },
    [readOnly, onChange],
  );
  const { contractQuery, contract } = useNodeContractView(node);

  // the upstream variables (friendly names, grouped by source node) — shared
  // by the Inputs tab (the mapping rows' source picker), the Config tab (the
  // per-field Variables picker) and the Contract tab (inherited input)
  const groups = useUpstreamGroups(incoming);
  // the next-edge parents' vocabulary as plain sources — only `next` edges
  // inherit (loop edges re-trigger, they publish nothing into the input)
  const upstreamSources = useMemo(
    () =>
      groups
        .filter((g) => g.edge.kind === NEXT_EDGE_KIND)
        .map((g) => ({
          key: g.source.key,
          label: g.label,
          fields: g.fields.map((f) => ({ name: f.name, type: f.type })),
        })),
    [groups],
  );
  // the full picker vocabulary (Phase 3 + 4): my inputs (the inherited merge
  // overlaid with the node's input_map) → task context → upstream nodes →
  // trigger payload — one shape for every variable surface
  const varGroups = useMemo(
    () =>
      buildVarGroups({
        taskFields: taskFields ?? [],
        triggerFields: triggerFields ?? [],
        upstream: upstreamSources,
        inputMap: (node?.input_map ?? {}) as Record<string, unknown>,
      }),
    [upstreamSources, taskFields, triggerFields, node?.input_map],
  );
  // only `next` edges inherit — the isolation hint keys on them
  const hasUpstream = groups.some((g) => g.edge.kind === NEXT_EDGE_KIND);

  const { tab, setTab, tabs } = useConfiguratorTabs({ node, contract });

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* isolation note — non-blocking: the node stays editable while it's
          unconnected (the amber canvas dot keeps flagging it) */}
      {locked && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/[0.04] px-3 py-2">
          <Unplug size={13} className="mt-0.5 shrink-0 text-warning" />
          <p className="text-[12px] text-warning/90 m-0">
            Not connected yet — drag from a node&apos;s handle on the canvas to
            wire it in. You can edit it meanwhile: the task context is available
            as variables, and connected upstream nodes&apos; outputs join them
            once an edge arrives.
          </p>
        </div>
      )}
      {/* this node's lint problems (Phase 5) — visible without hunting; the
          prompt editor's underlines + the expression editors' preview lines
          localize the same errors where they're typed */}
      {problems && problems.length > 0 && (
        <div className="mb-3 grid gap-1 rounded-lg border border-destructive/30 bg-destructive/[0.04] px-3 py-2">
          {problems.map((p, i) => (
            <p key={i} className="text-[12px] text-destructive m-0 first:pt-0.5">
              {p}
            </p>
          ))}
        </div>
      )}
      {/* the contract read failed — the Config/Contract/Prompt tabs depend on
          it; offer a retry instead of spinning forever */}
      {contractQuery.isError && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.04] px-3 py-2">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-destructive" />
          <p className="text-[12px] text-destructive m-0">
            Couldn&apos;t load this node&apos;s contract — the config and
            outputs stay unavailable until it loads.
          </p>
          <Button
            variant="outline"
            size="xs"
            className="shrink-0"
            onClick={() => void contractQuery.refetch()}
          >
            <RefreshCw size={12} /> Retry
          </Button>
        </div>
      )}
      {/* tabs */}
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as typeof tab)}
        className="flex flex-col min-h-0 flex-1 gap-0"
      >
        <TabsList
          variant="line"
          aria-label="Node configuration sections"
          className="h-auto w-full justify-start rounded-none border-b border-border -mx-2 px-2 bg-transparent"
        >
          {tabs.map((t) => (
            <TabsTrigger
              key={t}
              value={t}
              className="rounded-none px-3 py-1.5 text-[12.5px] font-medium data-active:border-info"
            >
              {TAB_LABELS[t] ?? t}
            </TabsTrigger>
          ))}
        </TabsList>

      <ScrollArea className="flex-1">
        <fieldset
          disabled={readOnly}
          className="min-w-0 border-0 p-0 m-0 pt-4 pr-1 disabled:opacity-100"
        >
        {tab === "trigger" ? (
          <TriggerTab node={node} onChange={emitChange} />
        ) : tab === "inputs" ? (
          <InputsTab
            key={node.key}
            node={node}
            upstream={upstreamSources}
            taskFields={taskFields}
            triggerFields={triggerFields}
            templateId={templateId}
            onChange={emitChange}
          />
        ) : tab === "prompt" ? (
          <PromptTab
            node={node}
            contract={contract}
            varGroups={varGroups}
            invalidRefs={invalidRefs}
            onChange={emitChange}
            registerPendingFlush={registerPendingFlush}
          />
        ) : tab === "config" ? (
          <ConfigTab
            node={node}
            onChange={emitChange}
            contract={contract}
            varGroups={varGroups}
            hasUpstream={hasUpstream}
            planDownstream={planDownstream}
            invalidRefs={invalidRefs}
            templateId={templateId}
          />
        ) : tab === "output" ? (
          <StartContractEditor
            key={node.key}
            node={node}
            onChange={emitChange}
            taskFields={taskFields}
          />
        ) : (
          <ContractView contract={contract} node={node} groups={groups} />
        )}
        </fieldset>
      </ScrollArea>
      </Tabs>
    </div>
  );
}
