"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ListChecks, Sparkles, Unplug } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Field, FieldDescription, FieldLabel } from "../ui/field";
import { ScrollArea } from "../ui/scroll-area";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { cn } from "../../lib/utils";
import { TRIGGER_TYPES, WAIT_FOR_GROUPS, WAIT_FOR_SOURCES } from "./constants";
import type { EditorEdge, EditorNode, NodeContract } from "./types";
import { contractsUrl, nodeLabel } from "./types";
import type { StartContractField } from "../../lib/engine/nodes/start/contract";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { InputsTab } from "./InputsTab";
import { DeclarativeConfigFields } from "./DeclarativeConfigFields";
import { PromptTab } from "./PromptTab";
import {
  ConfigFieldRow,
  SelectOption,
  companionTextOf,
  freeTextFields,
  promptEditorKeys,
  writeConfig,
} from "./ConfigFieldRow";
export { SelectOption } from "./ConfigFieldRow";
import {
  buildVarGroups,
  schemaRows,
  type VarGroup,
} from "./variables";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from "../ui/code-block";
import { parseInputContract, type InputFieldRow } from "./ts-schema-lite";

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
 * (Phase 5) embeds it in a node drawer.
 */

/** An edge arriving at the configured node, with the source node resolved. */
export interface IncomingLink {
  edge: EditorEdge;
  /** index in the draft's edge list (stable — only used for display) */
  edgeIndex: number;
  source: EditorNode | null;
}

/** The seeded Start catalog row id; the start contract is edited per instance. */
function isStartNode(node: EditorNode): boolean {
  return (
    node.nodeTemplateId === "nt_start" ||
    (node.is_builtin && (node.catalog_name ?? "").toLowerCase() === "start")
  );
}

/** Tab button labels (the start node shows only a subset of the tabs).
 *  D4: the start editor's tab is "Start fields" and the contract view is
 *  "Inputs & outputs" — one name per mental slot everywhere. */
const TAB_LABELS: Record<string, string> = {
  trigger: "Trigger",
  inputs: "Inputs",
  prompt: "Prompt",
  config: "Config",
  contract: "Inputs & outputs",
  output: "Start fields",
};

/** Dropdown option renderer — the label as the heading, the description
 *  below it in gray. (Lives in ConfigFieldRow.tsx — re-exported here for the
 *  hosts that imported it from the configurator.) */

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
}: {
  node: EditorNode;
  onChange: (p: Partial<EditorNode>) => void;
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
}) {
  const [tab, setTab] = useState<
    "trigger" | "inputs" | "prompt" | "config" | "output" | "contract"
  >("trigger");
  const [contract, setContract] = useState<NodeContract | null>(null);
  const start = node ? isStartNode(node) : false;

  // reset per node + load the contract from the registry / declarative def.
  // A node with no config yet opens on Config — for a freshly placed node the
  // work is the prompt/knobs (the trigger defaults to auto); anything already
  // configured opens on Trigger as before.
  useEffect(() => {
    setTab(
      node && !isStartNode(node) && Object.keys(node.config ?? {}).length === 0
        ? "config"
        : "trigger",
    );
    setContract(null);
  }, [node?.nodeTemplateId, node?.key]);

  useEffect(() => {
    if (!node || contract != null) return;
    let alive = true;
    // the instance config rides along: the start node's contract is declared
    // per instance, so its input/output schemas are derived from it. Draft
    // instances (Phase 2 — no catalog row yet) synthesize from their kind.
    fetch(contractsUrl(node))
      .then((r) => r.json())
      .then((c: any) => {
        if (!alive) return;
        if (c && c.input != null) setContract(c as NodeContract);
        else {
          // unknown kind (Phase 3) — an empty contract keeps the tabs usable
          const empty: NodeContract = {
            key: node.nodeTemplateId,
            label: node.catalog_name ?? node.key,
            kind: node.kind ?? "",
            input: null,
            output: null,
            config: { fields: [], defaults: {} },
          };
          setContract(empty);
        }
        // a freshly placed node opens on the Prompt tab — the prompt is the
        // work for prompt-carrying kinds (the Config tab no longer holds it)
        const loaded = c && c.input != null ? (c as NodeContract) : null;
        const hasPrompt = (loaded?.config?.fields ?? []).some((f) => promptEditorKeys.has(f.key));
        if (hasPrompt && Object.keys(node.config ?? {}).length === 0) setTab("prompt");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // `contract` in deps: the reset effect clears it when the selected node
    // changes (two instances can share a nodeTemplateId)
  }, [node?.nodeTemplateId, node?.config, contract]);

  // the upstream variables (friendly names, grouped by source node) — shared
  // by the Inputs tab (the mapping rows' source picker), the Config tab (the
  // per-field Variables picker) and the Contract tab (inherited input)
  const groups = useUpstreamGroups(incoming);
  // the next-edge parents' vocabulary as plain sources — only `next` edges
  // inherit (loop edges re-trigger, they publish nothing into the input)
  const upstreamSources = useMemo(
    () =>
      groups
        .filter((g) => g.edge.kind === "next")
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
  const hasUpstream = groups.some((g) => g.edge.kind === "next");

  // the start node has no config and no input mapping — its fields flow
  // straight to the next nodes, so it gets Trigger + Output Schema only.
  // Prompt-carrying nodes get a dedicated Prompt tab (the full three-part
  // editor) — the prompt fields leave the Config tab for it.
  const hasPromptFields = (contract?.config?.fields ?? []).some((f) =>
    promptEditorKeys.has(f.key),
  );
  const tabs = start
    ? (["trigger", "output"] as const)
    : hasPromptFields
      ? (["trigger", "inputs", "prompt", "config", "contract"] as const)
      : (["trigger", "inputs", "config", "contract"] as const);

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
      {/* tabs */}
      <div className="flex gap-1 border-b border-border -mx-2 px-2">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-3 py-1.5 text-[12.5px] font-medium border-b-[1.5px] -mb-px",
              tab === t
                ? "text-foreground border-info"
                : "text-muted-foreground border-transparent hover:text-foreground",
            )}
          >
            {TAB_LABELS[t] ?? t}
          </button>
        ))}
      </div>

      <ScrollArea className="flex-1">
        <div className="pt-4 pr-1">
        {tab === "trigger" ? (
          <TriggerTab node={node} onChange={onChange} />
        ) : tab === "inputs" ? (
          <InputsTab
            node={node}
            upstream={upstreamSources}
            taskFields={taskFields}
            triggerFields={triggerFields}
            templateId={templateId}
            onChange={onChange}
          />
        ) : tab === "prompt" ? (
          <PromptTab
            node={node}
            contract={contract}
            varGroups={varGroups}
            invalidRefs={invalidRefs}
            onChange={onChange}
          />
        ) : tab === "config" ? (
          <ConfigTab
            node={node}
            onChange={onChange}
            contract={contract}
            varGroups={varGroups}
            hasUpstream={hasUpstream}
            planDownstream={planDownstream}
            invalidRefs={invalidRefs}
            templateId={templateId}
          />
        ) : tab === "output" ? (
          <StartContractEditor node={node} onChange={onChange} taskFields={taskFields} />
        ) : (
          <ContractView contract={contract} node={node} groups={groups} />
        )}
        </div>
      </ScrollArea>
    </div>
  );
}

function TriggerTab({
  node,
  onChange,
}: {
  node: EditorNode;
  onChange: (p: Partial<EditorNode>) => void;
}) {
  const t = node.trigger;
  const source = WAIT_FOR_SOURCES.find((w) => w.value === t.wait_for);
  const contractFields = Array.isArray(node.config?.contract)
    ? (node.config.contract as StartContractField[])
    : [];
  return (
    <div className="grid gap-3">
      <Field>
        <FieldLabel htmlFor="node-trigger-type">Trigger type</FieldLabel>
        <Select
          value={t.type}
          onValueChange={(v) => {
            const next = v ?? t.type;
            if (next === t.type) return;
            const contractFields = Array.isArray(node.config?.contract)
              ? (node.config.contract as StartContractField[])
              : [];
            // wait-for events only make sense for auto — leaving it drops the
            // wait (and with it the event's enforced run-context field)
            const wait = next === "auto" ? t.wait_for : undefined;
            const droppingWait = wait === undefined && t.wait_for != null;
            const ctxKey = contextFieldKeyOf(t.wait_for);
            const stripped =
              droppingWait && ctxKey
                ? contractFields.filter((f) => f.key !== ctxKey)
                : contractFields;
            // defaults are an auto-trigger concern (auto publishes them) —
            // switching the type clears them
            const changed =
              stripped.some((f) => f.default !== undefined) ||
              stripped !== contractFields;
            onChange({
              trigger: { ...t, type: next, wait_for: wait },
              ...(changed
                ? {
                    config: {
                      ...(node.config ?? {}),
                      contract: stripped.map((f) => ({
                        ...f,
                        default: undefined,
                      })),
                    },
                  }
                : {}),
            });
          }}
        >
          <SelectTrigger id="node-trigger-type" className="w-full rounded-lg border-border bg-card">
            <SelectValue>{TRIGGER_TYPES[t.type]?.label ?? t.type}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(TRIGGER_TYPES).map(([v, opt]) => (
              <SelectItem key={v} value={v}>
                <SelectOption label={opt.label} description={opt.description} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {t.type === "debounced" && (
        <Field>
          <FieldLabel htmlFor="node-trigger-quiet-period">
            Quiet period (minutes)
          </FieldLabel>
          <Input
            id="node-trigger-quiet-period"
            type="number"
            min={0}
            value={t.minutes ?? 10}
            onChange={(e) =>
              onChange({
                trigger: { ...t, minutes: Number(e.target.value) || 0 },
              })
            }
          />
        </Field>
      )}
      {/* wait-for events only make sense for an auto trigger — the other
          types decide their own start (user click / approve / quiet period) */}
      {t.type === "auto" && (
        <Field>
          <FieldLabel htmlFor="node-trigger-wait-for">
            Wait for event
          </FieldLabel>
          <Select
            value={t.wait_for ?? null}
            onValueChange={(v) =>
              onChange({
                trigger: { ...t, wait_for: (v as string) || undefined },
              })
            }
          >
            <SelectTrigger id="node-trigger-wait-for" className="w-full rounded-lg border-border bg-card">
              <SelectValue placeholder="Starts when node is reached">
                {source?.label ?? t.wait_for ?? undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {WAIT_FOR_GROUPS.map((g) => (
                <SelectGroup key={g.label}>
                  <SelectLabel>{g.label}</SelectLabel>
                  {g.sources.map((w) => (
                    <SelectItem key={w.value} value={w.value}>
                      <SelectOption
                        label={w.label}
                        description={w.description}
                      />
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      {t.wait_for === "webhook" && (
        <WebhookRequestExample fields={contractFields} />
      )}
      {t.wait_for === "timer" && (
        <Field>
          <FieldLabel htmlFor="node-trigger-timer">
            Timer (minutes)
          </FieldLabel>
          <Input
            id="node-trigger-timer"
            type="number"
            min={0}
            value={t.minutes ?? 1}
            onChange={(e) =>
              onChange({
                trigger: { ...t, minutes: Number(e.target.value) || 0 },
              })
            }
          />
          <FieldDescription>
            Once the node is ready, it waits this many minutes and then starts
            automatically.
          </FieldDescription>
        </Field>
      )}
    </div>
  );
}

/**
 * The inbound delivery that resumes a `wait_for: webhook` node (§6): the hook
 * is provisioned per flow instance, so the example carries `{hook_id}` /
 * `{secret}` placeholders and a body shaped from the run context fields — the
 * delivery becomes the node's `{{trigger.payload}}`.
 */
function WebhookRequestExample({ fields }: { fields: StartContractField[] }) {
  const sampleValue = (type: StartContractField["type"]): unknown =>
    type === "number"
      ? 0
      : type === "boolean"
        ? true
        : type === "object"
          ? {}
          : type === "array"
            ? []
            : "…";
  const body = fields.length
    ? JSON.stringify(
        Object.fromEntries(fields.map((f) => [f.key, sampleValue(f.type)])),
        null,
        2,
      )
    : "{}";
  const curl = `curl -X POST /api/hooks/{hook_id} \\
  -H "x-devflow-secret: {secret}" \\
  -H "content-type: application/json" \\
  -d '${body}'`;
  return (
    <div className="grid gap-1">
      <CodeBlock size="sm">
        <CodeBlockHeader>
          <CodeBlockTitle>Request example — resumes this node</CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton value={curl} />
          </CodeBlockActions>
        </CodeBlockHeader>
        <CodeBlockContent>{curl}</CodeBlockContent>
      </CodeBlock>
    </div>
  );
}

function ConfigTab({
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
  // http nodes (Phase 6): the configured secret names — fetched once (names
  // only; values never leave the server) and offered as {{secrets.NAME}}
  // chips under the fields where secrets resolve
  const isHttp = node.kind === "http";
  const [secretNames, setSecretNames] = useState<string[] | null>(null);
  useEffect(() => {
    if (!isHttp) return;
    let alive = true;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (alive) setSecretNames(d?.secrets ?? []);
      })
      .catch(() => {
        if (alive) setSecretNames([]);
      });
    return () => {
      alive = false;
    };
  }, [isHttp]);

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
  // the prompt fields moved to the dedicated Prompt tab
  const nonPromptFields = fields.filter((f) => !promptEditorKeys.has(f.key));
  return (
    <div className="grid gap-3">
      {inheritHint}
      {fanoutHint}
      {nonPromptFields.length === 0 && !contract && (
        <p className="text-muted-foreground text-[13px]">
          <Spinner /> Loading schema…
        </p>
      )}
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

/** The shared fan-out knob keys (the Fanout section — lib/engine/node-config.ts
 *  `fanoutConfigFields`): the ConfigTab hides them unless the node is
 *  plan-downstream (save-time lint rule 1, mirrored in the editor). */
const FANOUT_FIELD_KEYS = new Set(["fanout_mode", "fanout_child", "fanout_parallel_max"]);

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

/** One upstream node's pickable variables (grouped by source in the pickers). */
export interface UpstreamGroup {
  source: EditorNode;
  edge: EditorEdge;
  label: string;
  fields: { name: string; type: string; required: boolean }[];
}

/**
 * Fetches each upstream node type's contract once and resolves the variable
 * groups for the incoming edges. The cache key includes the instance config —
 * the start node's contract is declared per instance, so its published
 * variables differ between start instances.
 */
function useUpstreamGroups(incoming?: IncomingLink[]): UpstreamGroup[] {
  const cache = useRef<Record<string, NodeContract | null>>({});
  const [contracts, setContracts] = useState<
    Record<string, NodeContract | null>
  >(cache.current);
  const defs = useMemo(
    () =>
      Array.from(
        new Map(
          (incoming ?? [])
            .filter((l) => l.source)
            .map((l) => [cacheKeyOf(l.source!), l.source!] as const),
        ).values(),
      ),
    [incoming],
  );
  // the effect keys off the cache keys (stable strings), not the node objects
  const defKeys = useMemo(() => defs.map(cacheKeyOf).join("|"), [defs]);
  useEffect(() => {
    let alive = true;
    setContracts((c) => ({ ...c, ...cache.current }));
    for (const src of defs) {
      const defKey = cacheKeyOf(src);
      if (cache.current[defKey] !== undefined) continue;
      fetch(contractsUrl(src))
        .then((r) => r.json())
        .then((c: any) => {
          const value: NodeContract | null = c && c.input != null ? c : null;
          cache.current[defKey] = value;
          if (alive) setContracts((cur) => ({ ...cur, [defKey]: value }));
        })
        .catch(() => {
          cache.current[defKey] = null;
          if (alive) setContracts((cur) => ({ ...cur, [defKey]: null }));
        });
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defKeys]);
  return useMemo(
    () =>
      (incoming ?? [])
        .filter((l) => l.source)
        .map((l) => {
          const src = l.source!;
          const fields = schemaRows(contracts[cacheKeyOf(src)]?.output ?? null);
          return { source: src, edge: l.edge, label: nodeLabel(src), fields };
        }),
    [incoming, contracts],
  );
}

function cacheKeyOf(src: EditorNode): string {
  const cfg =
    src.config && Object.keys(src.config).length
      ? JSON.stringify(src.config)
      : "";
  return `${src.nodeTemplateId}::${cfg}`;
}


// ── start contract editor: the fields the flow starts with ──────────────────

/**
 * The Start node's run context — the fields the flow starts with, authored
 * with the same TS-lite schema box the agent node uses: members `name[?]: type`
 * compile to the contract rows. The start node validates the values the
 * trigger provides and simply passes them to the next nodes (they map from
 * those variables); who fills the values follows the start node's trigger
 * type. The waited event's variable (MR / pipeline) is enforced on top:
 * present and required while its source is selected — written by the
 * enforcement below, never required of the author. Per-field extras — the
 * friendly label and the auto-trigger default — are edited under the box.
 */
export function StartContractEditor({
  node,
  onChange,
  taskFields,
}: {
  node: EditorNode;
  onChange: (p: Partial<EditorNode>) => void;
  /** the template's declared task type's contextFields (Phase 3) — powers the
   *  "seed from task context" convenience (fields the task already provides) */
  taskFields?: { key: string; label: string; type: string; required?: boolean }[];
}) {
  const config = node.config ?? {};
  const fields = Array.isArray(config.contract)
    ? (config.contract as StartContractField[])
    : [];
  const waitFor = node.trigger.wait_for;
  const ctxKey = contextFieldKeyOf(waitFor);

  // the TS-lite authoring text — re-seeded on mount (the body resets to the
  // Trigger tab on node change, so a fresh visit re-seeds fresh)
  const [tsText, setTsText] = useState<string>(() => startFieldsToTs(fields));

  // live compile of the authoring text → contract rows (errors surface inline)
  const parsed = useMemo(
    () =>
      tsText.trim()
        ? parseInputContract(tsText)
        : {
            inputs: [] as InputFieldRow[],
            error: undefined as string | undefined,
          },
    [tsText],
  );

  // the box is the source of truth for the authored fields; the waited event's
  // variable is enforced on top (parse errors keep the last good contract)
  useEffect(() => {
    if (parsed.error) return;
    const next = withContextFields(
      buildStartContract(parsed.inputs, fields),
      waitFor,
    );
    onChange({ config: { ...config, contract: next } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tsText]);

  // the enforced field must be on the config even when the box text hasn't
  // changed (the wait-for source was just picked on the Trigger tab)
  useEffect(() => {
    const target = withContextFields(fields, waitFor);
    if (JSON.stringify(target) === JSON.stringify(fields)) return;
    onChange({ config: { ...config, contract: target } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitFor]);

  const patchField = (i: number, patch: Partial<StartContractField>) =>
    onChange({
      config: {
        ...config,
        contract: fields.map((f, j) => (j === i ? { ...f, ...patch } : f)),
      },
    });

  const setDefault = (
    i: number,
    raw: string,
    type: StartContractField["type"],
  ) => {
    const f = fields[i];
    let v: unknown;
    if (raw.trim() === "") v = undefined;
    else if (type === "number")
      v = Number.isNaN(Number(raw)) ? raw : Number(raw);
    else if (type === "object" || type === "array") {
      try {
        v = JSON.parse(raw);
      } catch {
        v = raw; /* keep typing */
      }
    } else v = raw;
    patchField(i, { default: v });
  };

  const defaultText = (f: StartContractField): string => {
    if (f.default === undefined || f.default === null || f.default === "")
      return "";
    return typeof f.default === "string"
      ? f.default
      : JSON.stringify(f.default);
  };

  return (
    <div className="grid gap-3">
      {taskFields && taskFields.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            title="Adds a contract field for every task context field the template's task type provides — convenience only: the contract and the task context stay composable"
            onClick={() => {
              const existing = new Set(fields.map((f) => f.key));
              const members = taskFields
                .filter((f) => !existing.has(f.key))
                .map((f) => `${f.key}${f.required ? "" : "?"}: ${startFieldTypeTs(f.type)};`);
              if (!members.length) return;
              setTsText(tsText.trim() ? `${tsText.trimEnd()}\n${members.join("\n")}` : members.join("\n"));
            }}
          >
            <Sparkles size={12} /> Seed from task context
          </Button>
          <span className="text-[11px] text-muted-foreground">
            adds fields for the {taskFields.length} {`{{task.*}}`} values the template&apos;s task type provides
          </span>
        </div>
      )}
      <Field>
        <FieldLabel htmlFor="node-run-context">Run context</FieldLabel>
        <Textarea
          id="node-run-context"
          value={tsText}
          onChange={(e) => setTsText(e.target.value)}
          rows={8}
          className="font-mono text-[12px]"
          placeholder={`{\n  task: string\n  priority?: number\n  labels: string[]\n  settings: Record<string, unknown>\n}`}
        />
        {parsed.error && (
          <Card className="p-2.5 text-[12px] text-destructive border-destructive/30">
            {parsed.error}
          </Card>
        )}
      </Field>
      {fields.map((f, i) => (
        <Card key={i} className="p-2.5 grid gap-1.5">
          <div className="flex items-center gap-2">
            <code className="font-mono text-[12.5px] text-info">
              {f.key}
            </code>
            <Badge variant="outline" className="text-[10px]">
              {f.type}
            </Badge>
            {f.required && (
              <Badge className="bg-warning/10 text-warning text-[10px]">
                required
              </Badge>
            )}
          </div>
          <div className={cn("grid gap-2", f.key !== ctxKey && "grid-cols-2")}>
            <Input
              value={f.label ?? ""}
              placeholder="Label (optional)"
              className="text-[12px]"
              onChange={(e) =>
                patchField(i, { label: e.target.value || undefined })
              }
            />
            {f.key !== ctxKey && (
              <Input
                value={defaultText(f)}
                placeholder={
                  f.type === "object" || f.type === "array"
                    ? "default (JSON)"
                    : "default"
                }
                type={f.type === "number" ? "number" : "text"}
                className={cn(
                  "text-[12px]",
                  (f.type === "object" || f.type === "array") && "font-mono",
                )}
                onChange={(e) => setDefault(i, e.target.value, f.type)}
              />
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

/** The contract rows → the TS-lite authoring text (`key[?]: type;` members). */
function startFieldsToTs(fields: StartContractField[]): string {
  return fields
    .map((f) => {
      const t = startFieldTypeTs(f.type);
      return `${f.key}${f.required ? "" : "?"}: ${t};`;
    })
    .join("\n");
}

/** A field type → the TS-lite member type (`array`→unknown[], `object`→Record). */
function startFieldTypeTs(type: string): string {
  return type === "array"
    ? "unknown[]"
    : type === "object"
      ? "Record<string, unknown>"
      : type;
}

/** The compiled TS rows → contract fields; label/default carried over from
 *  the previous contract by key, so the per-field extras survive edits. */
function buildStartContract(
  rows: InputFieldRow[],
  prev: StartContractField[],
): StartContractField[] {
  const prevByKey = new Map(prev.map((f) => [f.key, f]));
  const seen = new Set<string>();
  const out: StartContractField[] = [];
  for (const r of rows) {
    if (!r.key || seen.has(r.key)) continue;
    seen.add(r.key);
    const p = prevByKey.get(r.key);
    out.push({
      key: r.key,
      label: p?.label,
      type: r.type ?? "object",
      required: Boolean(r.required),
      default: p?.default,
    });
  }
  return out;
}

/** The run-context field the waited event publishes (MR / pipeline), if any. */
function contextFieldKeyOf(waitFor: string | undefined): string | null {
  return waitFor
    ? (WAIT_FOR_SOURCES.find((w) => w.value === waitFor)?.contextField?.key ??
        null)
    : null;
}

/**
 * Enforce the waited event's variable on the run context: present and
 * required while its source is selected (kept in place if the author
 * declared it themselves; prepended when missing). The author never has to
 * write it in the schema box.
 */
function withContextFields(
  fields: StartContractField[],
  waitFor: string | undefined,
): StartContractField[] {
  const cf = waitFor
    ? WAIT_FOR_SOURCES.find((w) => w.value === waitFor)?.contextField
    : undefined;
  if (!cf) return fields;
  const idx = fields.findIndex((f) => f.key === cf.key);
  if (idx === -1)
    return [{ key: cf.key, type: cf.type, required: true }, ...fields];
  if (fields[idx].required) return fields;
  const next = [...fields];
  next[idx] = { ...fields[idx], required: true };
  return next;
}

function ContractView({
  contract,
  node,
  groups,
}: {
  contract: NodeContract | null;
  node: EditorNode;
  /** the connected upstream nodes' published outputs — this node's input */
  groups: UpstreamGroup[];
}) {
  if (!contract)
    return (
      <p className="text-muted-foreground text-[13px]">
        <Spinner /> Loading contract…
      </p>
    );
  const rows = schemaRows(contract.output);
  return (
    <div className="grid gap-4">
      <section>
        <h4 className="text-[12.5px] font-medium mb-1.5 flex items-center gap-1.5">
          <ListChecks size={13} /> Inputs — inherited from the upstream nodes
        </h4>
        {groups.length === 0 && (
          <p className="text-[12px] text-muted-foreground m-0">
            No upstream node — connect one on the canvas; whatever it publishes
            becomes this node&apos;s input (addressed as{" "}
            <code className="font-mono">{`{{input.<field>}}`}</code> in prompts).
          </p>
        )}
        {groups.length > 0 && (
          <p className="text-[11px] text-muted-foreground mt-1 mb-1.5 m-0 first:mt-0">
            The merged view of what arrives (last-finished parent wins on
            conflicts) — map individual fields on the Inputs tab.
          </p>
        )}
        {groups.map((g) => (
          <div key={g.source.key} className="grid gap-1 mb-1.5 last:mb-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[12px] font-medium truncate">{g.label}</span>
              <code className="font-mono text-[10.5px] text-muted-foreground">{g.source.key}</code>
            </div>
            <ContractTable rows={g.fields} empty="(no declared outputs)" />
          </div>
        ))}
      </section>
      <section>
        <h4 className="text-[12.5px] font-medium mb-1.5 flex items-center gap-1.5">
          <ListChecks size={13} /> Outputs — published to the flow
        </h4>
        <ContractTable rows={rows} empty="No declared output fields." />
        {contract.output &&
          contract.output.type === "object" &&
          contract.output.properties?.markdown === undefined && (
            <p className="text-[11px] text-muted-foreground mt-1.5 m-0">
              Addressed downstream as{" "}
              <code className="font-mono">
                {"{{nodes." + node.key + ".output.<field>}}"}
              </code>
            </p>
          )}
      </section>
    </div>
  );
}

function ContractTable({
  rows,
  empty,
}: {
  rows: { name: string; type: string; required: boolean }[];
  empty: string;
}) {
  if (!rows.length)
    return <p className="text-[12px] text-muted-foreground m-0">{empty}</p>;
  return (
    <div className="border border-border rounded-lg overflow-hidden text-[12.5px]">
      {rows.map((r) => (
        <div
          key={r.name}
          className="flex items-center gap-2 px-3 py-1.5 border-b border-border last:border-0"
        >
          <code className="font-mono text-info">{r.name}</code>
          <Badge variant="outline" className="text-[10px]">
            {r.type}
          </Badge>
          {r.required && (
            <Badge className="bg-warning/10 text-warning text-[10px]">
              required
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
}
