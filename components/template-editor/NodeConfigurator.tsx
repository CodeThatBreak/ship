"use client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, AlertTriangle, Info, ListChecks, Plus, Sparkles, Trash2, Unplug } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../ui/tooltip";
import { PromptEditor } from "./PromptEditor";
import { ConditionBuilder, ExpressionInput } from "./ConditionBuilder";
import { iconForIconName } from "./icons";
import { InputsTab } from "./InputsTab";
import {
  asJsonataGroups,
  buildVarGroups,
  conditionVarGroups,
  filterVarGroups,
  httpResponseVarGroups,
  schemaRows,
  varGroupAccent,
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
import { parseInputContract, parseOutputContract, type InputFieldRow } from "./ts-schema-lite";

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
  config: "Config",
  contract: "Inputs & outputs",
  output: "Start fields",
};

/** Dropdown option renderer — the label as the heading, the description
 *  below it in gray. */
export function SelectOption({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  return (
    <div className="grid gap-0.5 whitespace-normal">
      <span className="text-[13px] leading-tight">{label}</span>
      <span className="text-[11px] text-muted-foreground leading-tight">
        {description}
      </span>
    </div>
  );
}

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
    "trigger" | "inputs" | "config" | "output" | "contract"
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
          setContract({
            key: node.nodeTemplateId,
            label: node.catalog_name ?? node.key,
            kind: node.kind ?? "",
            input: null,
            output: null,
            config: { fields: [], defaults: {} },
          });
        }
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
  // straight to the next nodes, so it gets Trigger + Output Schema only
  const tabs = start
    ? (["trigger", "output"] as const)
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
      <div className="grid gap-1">
        <Label>Trigger type</Label>
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
          <SelectTrigger className="w-full rounded-lg border-border bg-card">
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
      </div>
      {t.type === "debounced" && (
        <div className="grid gap-1">
          <Label>
            Quiet period (minutes)
          </Label>
          <Input
            type="number"
            min={0}
            value={t.minutes ?? 10}
            onChange={(e) =>
              onChange({
                trigger: { ...t, minutes: Number(e.target.value) || 0 },
              })
            }
          />
        </div>
      )}
      {/* wait-for events only make sense for an auto trigger — the other
          types decide their own start (user click / approve / quiet period) */}
      {t.type === "auto" && (
        <div className="grid gap-1">
          <Label>
            Wait for event
          </Label>
          <Select
            value={t.wait_for ?? null}
            onValueChange={(v) =>
              onChange({
                trigger: { ...t, wait_for: (v as string) || undefined },
              })
            }
          >
            <SelectTrigger className="w-full rounded-lg border-border bg-card">
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
        </div>
      )}
      {t.wait_for === "webhook" && (
        <WebhookRequestExample fields={contractFields} />
      )}
      {t.wait_for === "timer" && (
        <div className="grid gap-1">
          <Label>
            Timer (minutes)
          </Label>
          <Input
            type="number"
            min={0}
            value={t.minutes ?? 1}
            onChange={(e) =>
              onChange({
                trigger: { ...t, minutes: Number(e.target.value) || 0 },
              })
            }
          />
          <p className="text-[11px] text-muted-foreground m-0">
            The node holds at <code className="font-mono">waiting</code> and the
            poller resumes it after this many minutes.
          </p>
        </div>
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
  if (node.is_builtin) {
    const fields = contract?.config?.fields ?? [];
    return (
      <div className="grid gap-3">
        {inheritHint}
        {fanoutHint}
        {fields.length === 0 && !contract && (
          <p className="text-muted-foreground text-[13px]">
            <Spinner /> Loading schema…
          </p>
        )}
        {fields.length === 0 && contract && (
          <p className="text-muted-foreground text-[13px]">
            This node has no configurability.
          </p>
        )}
        {fields
          .filter((f) => !FANOUT_FIELD_KEYS.has(f.key) || showFanout)
          .map((f) => (
          <ConfigFieldRow
            key={`${node.key}:${f.key}`}
            field={f}
            value={node.config?.[f.key]}
            companionText={companionTextOf(node, f.key)}
            varGroups={freeTextFields.has(f.key) ? varGroups : undefined}
            invalidRefs={invalidRefs}
            templateId={templateId}
            onChange={(v, extra) =>
              onChange({ config: writeConfig(node, f.key, v, extra) })
            }
          />
        ))}
      </div>
    );
  }
  // declarative kinds: the catalog definition IS the config — the form is
  // schema-driven from the kind's configFields (same shape as built-ins);
  // values set here override the catalog definition for this template instance
  const fields = contract?.config?.fields ?? [];
  const defaults = (contract?.config?.defaults ?? {}) as Record<string, unknown>;
  // the agent's output schema only matters when the output format is json —
  // an override output wins over the catalog default
  const agentOutputJson =
    node.kind === "agent" &&
    (node.config?.output ?? defaults.output) === "json";
  // the decision's source picks its fields: the prompt only matters for the
  // agent source, and the single global expression field is superseded by the
  // per-choice conditions edited inside the choices editor
  const decisionSource =
    node.kind === "decision"
      ? String(node.config?.source ?? defaults.source ?? "manual")
      : undefined;
  if (fields.length) {
    return (
      <div className="grid gap-3">
        {inheritHint}
        {fanoutHint}
        {fields
          .filter(
            (f) =>
              !(f.key === "output_schema" && node.kind === "agent") ||
              agentOutputJson ||
              node.config?.output_schema != null,
          )
          .filter((f) => !(node.kind === "decision" && f.key === "expression"))
          .filter(
            (f) =>
              !(node.kind === "decision" && f.key === "question") ||
              decisionSource === "agent",
          )
          .filter((f) => !FANOUT_FIELD_KEYS.has(f.key) || showFanout)
          .map((f) => (
          <ConfigFieldRow
            key={`${node.key}:${f.key}`}
            field={f}
            value={node.config?.[f.key]}
            defaultValue={defaults[f.key]}
            companionText={companionTextOf(node, f.key, defaults[f.key])}
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
              onChange({ config: writeConfig(node, f.key, v, extra) })
            }
          />
        ))}
      </div>
    );
  }
  // fallback for kinds without configFields (shouldn't happen — every
  // declarative class declares its fields)
  const cfg = node.config ?? {};
  return (
    <div className="grid gap-3">
      <Textarea
        value={Object.keys(cfg).length ? JSON.stringify(cfg, null, 2) : ""}
        onChange={(e) => {
          try {
            onChange({
              config: e.target.value.trim() ? JSON.parse(e.target.value) : {},
            });
          } catch {
            /* keep typing */
          }
        }}
        rows={8}
        className="font-mono text-[12px]"
        placeholder="{}"
      />
    </div>
  );
}

/** config knobs that carry {{...}} template refs — they get the "Variables ▾" picker */
const freeTextFields = new Set([
  "prompt",
  "prompt_body",
  "fix_prompt_body",
  "model",
  "url",
  "body",
  "question",
]);

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

/** The http fields where `{{secrets.NAME}}` resolves (Phase 6) — they get the
 *  configured-secrets chip group under the input. */
const secretFields = new Set(["url", "headers", "body"]);

/**
 * The node's vocabulary as the condition/expression editors' groups (Phase 5):
 * brace-stripped, minus "My inputs" (the flow context map has no `input`
 * root — conditions and pass maps see task / upstream / trigger / flow /
 * repo), plus the flow & repo group.
 */
function condVarGroups(groups?: VarGroup[]): VarGroup[] {
  return asJsonataGroups(conditionVarGroups(groups ?? []));
}

/**
 * The companion key an editor writes alongside its compiled value — the
 * `ts_output` box stores the raw TypeScript members the author typed
 * (`<key>_ts`), so the box re-seeds to their source instead of the compiled
 * JSON Schema after a remount (format switches, tab switches, node changes).
 * An instance without an override falls back to the catalog def's companion
 * (the create dialog persists its box text on the def).
 */
function companionTextOf(
  node: EditorNode,
  key: string,
  defaultValue?: unknown,
): unknown {
  const cfg = node.config as Record<string, unknown> | undefined;
  const own = cfg?.[`${key}_ts`];
  if (own !== undefined) return own;
  return (defaultValue as Record<string, unknown> | undefined)?.[`${key}_ts`];
}

/** The instance config after one field edit: the written value plus any
 *  companion the editor carries along (undefined values drop out on
 *  persist — removing the override lets the catalog default apply). */
function writeConfig(
  node: EditorNode,
  key: string,
  v: unknown,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(node.config as Record<string, unknown>), ...extra, [key]: v };
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


function ConfigFieldRow({
  field,
  value,
  defaultValue,
  companionText,
  decisionSource,
  secrets,
  varGroups,
  invalidRefs,
  templateId,
  onChange,
}: {
  field: {
    key: string;
    label: string;
    type: string;
    help?: string;
    options?: { value: string; label: string; description?: string }[];
    optionIcons?: Record<string, string>;
    nullable?: boolean;
  };
  value: unknown;
  /** the catalog/class default (shown as placeholder when no override is set) */
  defaultValue?: unknown;
  /** the companion authoring text (`<key>_ts`) the ts_output box persister stores */
  companionText?: unknown;
  /** a decision node's current source — the choices editor shows per-choice
   *  conditions for the expression source */
  decisionSource?: string;
  /** configured secret names (Phase 6, http nodes) — the {{secrets.NAME}}
   *  chip group under the field */
  secrets?: string[];
  /** the grouped variable vocabulary — the prompt editor's @ popover / the
   *  field's "Variables ▾" picker (Phase 3) */
  varGroups?: VarGroup[];
  /** live-linted refs → the linter's problem (prompt fields underline them) */
  invalidRefs?: Record<string, string>;
  /** the owning template's id (Phase 5) — the expression editors' preview */
  templateId?: string;
  onChange: (v: unknown, extra?: Record<string, unknown>) => void;
}) {
  const effective = value !== undefined ? value : defaultValue;
  // raw-JSONata text fields get the live expression editor (Phase 5): the
  // http response_map evaluates against the response object, not the flow
  // context — its vocabulary + preview scope differ accordingly
  if (field.type === "text" && field.key === "response_map") {
    return (
      <div className="grid gap-1">
        <FieldLabel field={field} />
        <ExpressionInput
          value={typeof effective === "string" ? effective : ""}
          varGroups={varGroups}
          templateId={templateId}
          scope="response"
          rows={3}
          placeholder={"body.result — must yield an object ({status, ok, body, headers} is the raw response)"}
          onChange={(v) => onChange(v.trim() ? v : null)}
        />
      </div>
    );
  }
  const insertRef = (ref: string) => {
    const cur = typeof value === "string" ? value : "";
    onChange(cur ? (cur.endsWith(" ") ? cur : `${cur} `) + ref : ref);
  };
  const fmtDefault = (v: unknown): string => {
    if (v == null || v === "") return "(default)";
    if (typeof v === "string")
      return v.length > 60
        ? `(default: ${v.slice(0, 60)}…)`
        : `(default: ${v})`;
    return `(default: ${JSON.stringify(v)})`;
  };
  // the declarative kinds' bespoke editors (schema boxes, branch choices)
  if (field.type === "ts_output") {
    return (
      <TsOutputEditor
        field={field}
        value={value}
        defaultValue={defaultValue}
        savedText={typeof companionText === "string" ? companionText : undefined}
        onChange={(schema, saved) =>
          onChange(schema, { [`${field.key}_ts`]: saved })
        }
      />
    );
  }
  if (field.type === "choices") {
    return (
      <ChoicesEditor
        field={field}
        value={value}
        defaultValue={defaultValue}
        source={decisionSource}
        varGroups={varGroups}
        templateId={templateId}
        onChange={onChange}
      />
    );
  }
  if (field.type === "map") {
    return (
      <PassMapEditor
        field={field}
        value={value}
        defaultValue={defaultValue}
        varGroups={varGroups}
        templateId={templateId}
        onChange={onChange}
      />
    );
  }
  if (field.type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-[13px] cursor-pointer">
        <Checkbox
          checked={effective === true}
          onCheckedChange={(v) => onChange(v === true)}
        />
        <span>{field.label}</span>
      </label>
    );
  }
  // prompt fields: the rich text editor — "@" opens the grouped variable
  // popover, and unresolvable refs underline where they're typed
  if (field.type === "text" && promptEditorKeys.has(field.key)) {
    return (
      <div className="grid gap-1.5">
        <FieldLabel field={field} />
        <PromptEditor
          value={typeof effective === "string" ? effective : ""}
          groups={varGroups ?? []}
          invalidRefs={invalidRefs}
          onChange={(text) => onChange(text || undefined)}
        />
      </div>
    );
  }
  // fan-out child: the gallery picker (Phase 3C) — flow templates EXCLUDING
  // hidden auto-wrapped child templates, for both built-in and declarative
  // (agent-kind) parents; empty = auto-select (built-in step build / self-wrap)
  if (field.key === "fanout_child") {
    return (
      <div className="grid gap-1">
        <FieldLabel field={field} />
        <FanoutChildPicker
          value={typeof effective === "string" ? effective : ""}
          onChange={(v) => onChange(v || undefined)}
        />
      </div>
    );
  }
  const picker = varGroups?.length ? (
    <VariablesPicker groups={varGroups} onInsert={insertRef} />
  ) : null;
  const control =
    field.type === "select" ? (
      <ConfigSelect
        options={field.options ?? []}
        optionIcons={field.optionIcons}
        effective={effective}
        defaultValue={defaultValue}
        defaultLabel={fmtDefault(defaultValue)}
        onChange={onChange}
      />
    ) : field.type === "text" ? (
      <Textarea
        value={
          typeof effective === "string"
            ? effective
            : effective != null
              ? JSON.stringify(effective, null, 2)
              : ""
        }
        onChange={(e) => onChange(e.target.value || undefined)}
        rows={5}
        className="font-mono text-[12px]"
        placeholder={fmtDefault(defaultValue)}
      />
    ) : field.type === "string" ? (
      <Input
        value={typeof effective === "string" ? effective : ""}
        onChange={(e) =>
          onChange(
            e.target.value === "" && field.nullable
              ? null // "cleared" the override — don't snap back to the default
              : e.target.value || undefined,
          )
        }
        placeholder={fmtDefault(defaultValue)}
        className="font-mono text-[12.5px]"
      />
    ) : (
      <Input
        type="number"
        value={typeof effective === "number" ? effective : ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? undefined : Number(e.target.value))
        }
        placeholder={fmtDefault(defaultValue)}
      />
    );
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel field={field} />
        {picker}
      </div>
      {control}
      {secrets != null && (
        <SecretsChipGroup names={secrets} onInsert={insertRef} />
      )}
    </div>
  );
}

/**
 * The http node's secrets chip group (Phase 6): the configured secret names
 * (GET /api/settings — names only, values never leave the server) as chips
 * that insert `{{secrets.NAME}}` into the field. Empty state points to the
 * Settings page where secrets are managed.
 */
function SecretsChipGroup({
  names,
  onInsert,
}: {
  names: string[];
  onInsert: (ref: string) => void;
}) {
  return (
    <div className="flex gap-1 flex-wrap items-center">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        secrets
      </span>
      {names.length === 0 ? (
        <span className="text-[11px] text-muted-foreground">
          none configured — add secrets under Settings
        </span>
      ) : (
        names.map((n) => (
          <button
            key={n}
            type="button"
            title={`Insert {{secrets.${n}}}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onInsert(`{{secrets.${n}}}`)}
            className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-mono text-muted-foreground transition-colors hover:border-info/50 hover:text-foreground"
          >
            {n}
          </button>
        ))
      )}
    </div>
  );
}

/** config fields authored with the rich prompt editor ("@" variable popover)
 *  — `question` is the decision agent's prompt */
const promptEditorKeys = new Set(["prompt", "prompt_body", "fix_prompt_body", "question"]);

/** A flow template as the fan-out child picker needs it (GET /api/templates:
 *  the gallery, hidden auto-wrapped child templates excluded, Phase 3C). */
interface GalleryTemplate {
  id: string;
  name: string;
  description?: string | null;
  nodeCount?: number;
}

/**
 * The fan-out child template picker (Phase 3C): a gallery select of flow
 * templates the node's steps run as. Hidden templates (the auto-wrapped
 * `"<label> · step"` children) never appear — a child template is referenced
 * by id, never picked (§2 data model). Entries show the template name with
 * its node count + description; a template value that no longer resolves
 * still renders (the save-time lint reports it as a problem). Empty
 * selection = auto-select: the built-in `step-build` child under build
 * nodes, the node's own hidden auto-wrap copy otherwise.
 */
function FanoutChildPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string | undefined) => void;
}) {
  const [templates, setTemplates] = useState<GalleryTemplate[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/templates")
      .then((r) => r.json())
      .then((d) => {
        if (alive) setTemplates(Array.isArray(d?.templates) ? (d.templates as GalleryTemplate[]) : []);
      })
      .catch(() => {
        if (alive) setTemplates([]);
      });
    return () => { alive = false; };
  }, []);

  const UNSET = "__auto__";
  const known = value && templates?.some((t) => t.id === value);
  return (
    <>
      <Select
        value={value ? (known || templates == null ? value : UNSET) : UNSET}
        onValueChange={(v) => onChange(v == null ? undefined : v === UNSET ? undefined : v)}
      >
        <SelectTrigger className="w-full rounded-lg border-border bg-card">
          <SelectValue>
            {value === ""
              ? "auto-select"
              : templates == null
                ? "loading…"
                : known
                  ? templates.find((t) => t.id === value)?.name ?? value
                  : `${value} (missing template)`}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNSET}>
            <SelectOption
              label="auto-select"
              description="Built-in step build under build nodes; every other node wraps itself as a hidden child template"
            />
          </SelectItem>
          {value != null && value !== "" && !known && (
            <SelectItem value={value!}>{value} (missing template)</SelectItem>
          )}
          {(templates ?? []).map((t) => (
            <SelectItem key={t.id} value={t.id}>
              <SelectOption
                label={t.name}
                description={
                  `${t.nodeCount ?? 0} node${(t.nodeCount ?? 0) === 1 ? "" : "s"}${t.description ? ` · ${t.description}` : ""}`
                }
              />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {templates?.length === 0 && (
        <p className="text-[11px] text-muted-foreground m-0">
          No flow templates in the gallery yet — create one in the template editor.
        </p>
      )}
    </>
  );
}

/**
 * The field label. Prompt fields carry an info icon — hovering it shows the
 * reference cheat-sheet (the help text lives in the tooltip, not the page).
 */
function FieldLabel({ field }: { field: { key: string; label: string; help?: string } }) {
  if (promptEditorKeys.has(field.key)) {
    return (
      <div className="flex items-center gap-1.5">
        <Label>{field.label}</Label>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex cursor-help text-muted-foreground hover:text-foreground transition-colors">
                <Info size={12} />
              </span>
            }
          />
          <TooltipContent className="max-w-[300px] whitespace-normal text-left leading-relaxed">
            {field.help ?? "Type @ to insert an upstream variable — refs resolve at run time."}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }
  return <Label>{field.label}</Label>;
}

/** A select config knob on the shadcn select. Variants:
 *  - rich (options carry descriptions): heading + gray description items, no
 *    "(default)" option — the effective value always resolves to one of the
 *    options (the catalog default shows as its own choice)
 *  - icon: the effective value is always one of the options (no empty item)
 *  - plain: a sentinel item resets to the default. */
function ConfigSelect({
  options,
  optionIcons,
  effective,
  defaultValue,
  defaultLabel,
  onChange,
}: {
  options: { value: string; label: string; description?: string }[];
  optionIcons?: Record<string, string>;
  effective: unknown;
  defaultValue?: unknown;
  defaultLabel: string;
  onChange: (v: unknown) => void;
}) {
  const current =
    effective != null && options.some((o) => o.value === String(effective))
      ? String(effective)
      : "";
  const selected = options.find((o) => o.value === current);
  if (options.some((o) => o.description)) {
    const value =
      selected?.value ??
      options.find((o) => o.value === String(defaultValue))?.value ??
      options[0]?.value ??
      "";
    return (
      <Select value={value} onValueChange={(v) => onChange(v ?? value)}>
        <SelectTrigger className="w-full rounded-lg border-border bg-card">
          <SelectValue>
            {options.find((o) => o.value === value)?.label ?? value}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              <SelectOption label={o.label} description={o.description ?? ""} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (optionIcons) {
    // icon variant (agent mode) — the effective value is always one of the options
    const value = current || options[0]?.value || "";
    return (
      <Select value={value} onValueChange={(v) => onChange(v ?? value)}>
        <SelectTrigger className="w-full rounded-lg border-border bg-card">
          <SelectValue>{selected?.label ?? value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => {
            const Icon = optionIcons[o.value] ? iconForIconName(optionIcons[o.value]) : null;
            return (
              <SelectItem key={o.value} value={o.value}>
                {Icon && <Icon size={13} className="text-muted-foreground shrink-0" />}
                {o.label}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    );
  }
  const UNSET = "__default__";
  return (
    <Select
      value={current || UNSET}
      onValueChange={(v) => onChange(v === UNSET ? undefined : v)}
    >
      <SelectTrigger className="w-full rounded-lg border-border bg-card">
        <SelectValue>{selected?.label ?? defaultLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNSET}>{defaultLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The agent's output schema — TS-lite members (or a pasted JSON Schema) that
 * compiles to the `output_schema` the json output is validated against.
 * The raw authoring text rides along in the config (`<key>_ts`): the compiled
 * schema is what the runtime uses, but the box re-seeds to what the author
 * wrote — format/tab switches remount the field without the authoring source
 * turning into JSON.
 */
function TsOutputEditor({
  field,
  value,
  defaultValue,
  savedText,
  onChange,
}: {
  field: { key: string; label: string; type: string; help?: string; options?: { value: string; label: string }[] };
  value: unknown;
  defaultValue?: unknown;
  /** the previously persisted authoring text — seed source on mount */
  savedText?: string;
  /** the compiled schema (undefined = cleared) + the raw authoring text */
  onChange: (schema: unknown, saved: string | undefined) => void;
}) {
  const effective = value !== undefined ? value : (defaultValue ?? null);
  const [text, setText] = useState<string>(() =>
    typeof savedText === "string" && savedText.trim()
      ? savedText
      : effective
        ? JSON.stringify(effective, null, 2)
        : "",
  );
  const [err, setErr] = useState<string | null>(null);

  // TS-lite parse wins (bare members); a valid JSON Schema object pasted in
  // is accepted as-is; anything else keeps the last good schema
  useEffect(() => {
    const src = text.trim();
    if (!src) {
      setErr(null);
      onChange(undefined, undefined);
      return;
    }
    const lite = parseOutputContract(src);
    if (!lite.error && lite.schema) {
      setErr(null);
      onChange(lite.schema, text);
      return;
    }
    try {
      const json = JSON.parse(src);
      if (json && typeof json === "object" && !Array.isArray(json)) {
        setErr(null);
        onChange(json, text);
        return;
      }
    } catch { /* fall through to the TS-lite error */ }
    setErr(lite.error ?? "declares no fields");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className="grid gap-1">
      <Label>{field.label}</Label>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        className="font-mono text-[12px]"
        placeholder={`{\n  summary: string\n  severity: "low" | "high"\n  files: string[]\n}`}
      />
      {err && (
        <Card className="p-2.5 text-[12px] text-destructive border-destructive/30">
          {err}
        </Card>
      )}
    </div>
  );
}

/**
 * The decision node's branch choices — label + description rows edited in
 * place (written as the instance override). At least one labeled choice is
 * required by the decision schema; an all-empty edit keeps the last good set
 * and warns instead.
 *
 * For the `expression` source each choice also carries a JSONata `condition`
 * over the flow context — every truthy condition picks that branch. The
 * condition is authored with the structured ConditionBuilder (Phase 5): rows
 * of `[variable][op][value]` compiled to JSONata, with the raw language one
 * toggle away and the value previewed underneath.
 */
function ChoicesEditor({
  field,
  value,
  defaultValue,
  source,
  varGroups,
  templateId,
  onChange,
}: {
  field: { key: string; label: string; type: string; help?: string; options?: { value: string; label: string }[] };
  value: unknown;
  defaultValue?: unknown;
  /** the decision's current source — "expression" adds the condition builders */
  source?: string;
  varGroups?: VarGroup[];
  templateId?: string;
  onChange: (v: unknown) => void;
}) {
  const effective = (
    Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : []
  ) as { label: string; description?: string; condition?: string }[];
  const [rows, setRows] = useState(() =>
    effective.map((c) => ({
      label: c.label,
      description: c.description ?? "",
      condition: c.condition ?? "",
    })),
  );
  const isExpression = source === "expression";

  const write = (next: { label: string; description: string; condition: string }[]) => {
    setRows(next);
    const labeled = next
      .map((c) => ({
        label: c.label.trim(),
        description: c.description.trim() || undefined,
        condition: c.condition.trim() || undefined,
      }))
      .filter((c) => c.label);
    if (labeled.length) onChange(labeled);
  };

  return (
    <div className="grid gap-1.5">
      <Label>Choices (branch labels)</Label>
      {rows.map((c, i) => (
        <div
          key={i}
          className={cn(
            "grid gap-1.5 rounded-lg border border-border p-2",
            isExpression && c.condition.trim() && "border-violet-500/40",
          )}
        >
          <div className="flex gap-1.5">
            <Input
              value={c.label}
              placeholder="label"
              className="max-w-[140px] font-mono text-[12px]"
              onChange={(e) => write(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            />
            <Input
              value={c.description}
              placeholder="description (steers an agent classifier)"
              className="text-[12px]"
              onChange={(e) => write(rows.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
            />
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={rows.length <= 1}
              title="Remove choice"
              onClick={() => write(rows.filter((_, j) => j !== i))}
            >
              <Trash2 size={12} />
            </Button>
          </div>
          {isExpression && (
            <ConditionBuilder
              value={c.condition}
              varGroups={condVarGroups(varGroups)}
              templateId={templateId}
              scope="context"
              placeholder="nodes.review.output.comment_count > 0"
              onChange={(raw) =>
                write(rows.map((x, j) => (j === i ? { ...x, condition: raw ?? "" } : x)))
              }
            />
          )}
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => write([...rows, { label: "", description: "", condition: "" }])}
      >
        <Plus size={12} /> Add choice
      </Button>
      {!rows.some((c) => c.label.trim()) && (
        <p className="text-[11px] text-warning m-0">At least one labeled choice is required.</p>
      )}
      {isExpression && !rows.some((c) => c.condition.trim()) && (
        <p className="text-[11px] text-warning m-0">
          No condition yet — give each choice a condition; every truthy condition picks its branch.
        </p>
      )}
    </div>
  );
}

/**
 * The decision's pass-down variables — field → JSONata rows edited in place
 * (the `pass` instance override). Every field is merged into the decision's
 * output beside chosen / rationale, so nodes attached to a branch address
 * them as `{{input.<field>}}` with no extra wiring. Each expression box is
 * the live ExpressionInput (Phase 5): paths autocomplete from the flow
 * context vocabulary, compile errors surface inline, and the evaluated value
 * renders underneath; a row with a name but no expression writes nothing.
 */
function PassMapEditor({
  field,
  value,
  defaultValue,
  varGroups,
  templateId,
  onChange,
}: {
  field: { key: string; label: string; type: string; help?: string };
  value: unknown;
  defaultValue?: unknown;
  varGroups?: VarGroup[];
  templateId?: string;
  onChange: (v: unknown) => void;
}) {
  const effective = (
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : defaultValue && typeof defaultValue === "object" && !Array.isArray(defaultValue)
        ? defaultValue
        : {}
  ) as Record<string, string>;
  const [rows, setRows] = useState<{ field: string; expr: string }[]>(() =>
    Object.entries(effective).map(([field, expr]) => ({ field, expr: typeof expr === "string" ? expr : "" })),
  );

  const write = (next: { field: string; expr: string }[]) => {
    setRows(next);
    const mapped: Record<string, string> = {};
    for (const r of next) {
      if (r.field.trim() && r.expr.trim()) mapped[r.field.trim()] = r.expr.trim();
    }
    onChange(mapped);
  };

  return (
    <div className="grid gap-1.5">
      <Label>{field.label}</Label>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[130px_1fr] gap-1.5 items-start">
          <Input
            value={r.field}
            placeholder="field name"
            className="font-mono text-[12px]"
            onChange={(e) => write(rows.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}
          />
          <div className="flex gap-1.5 items-start">
            <ExpressionInput
              value={r.expr}
              varGroups={condVarGroups(varGroups)}
              templateId={templateId}
              scope="context"
              rows={1}
              placeholder="JSONata — e.g. nodes.review.output.summary"
              onChange={(v) => write(rows.map((x, j) => (j === i ? { ...x, expr: v } : x)))}
            />
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              title="Remove variable"
              onClick={() => write(rows.filter((_, j) => j !== i))}
            >
              <Trash2 size={12} />
            </Button>
          </div>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => write([...rows, { field: "", expr: "" }])}
      >
        <Plus size={12} /> Add variable
      </Button>
      <p className="text-[11px] text-muted-foreground m-0">
        Downstream nodes read these as <code className="font-mono">{`{{input.<field>}}`}</code> —
        chosen / rationale are passed automatically.
      </p>
    </div>
  );
}

/**
 * The per-field "Variables ▾" picker (Phase 3): one affordance for every
 * ref-bearing field — the grouped vocabulary (inherited → task → upstream →
 * trigger) in an anchored panel with a search box; picking a field inserts
 * its `{{...}}` ref (click-to-insert supersedes the old chip rows). Every
 * caller is a {{...}}-templated field (prompts use the @ popover's same
 * vocabulary), so the braces ride along; the raw-JSONata surfaces compile
 * their options separately (`jsonataPathOptions`). `jsonata` callers pass
 * pre-stripped groups (`asJsonataGroups`) when they need bare paths.
 */
export function VariablesPicker({
  groups,
  onInsert,
}: {
  groups: VarGroup[];
  onInsert: (ref: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const shown = filterVarGroups(groups, query);

  // close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        className="rounded-full text-[11px] text-muted-foreground hover:text-foreground"
      >
        Variables <ChevronDown size={10} className={cn("transition-transform", open && "rotate-180")} />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 flex w-72 max-h-64 flex-col rounded-lg border border-border bg-popover p-1 shadow-lg">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search variables…"
            className="mb-1 border-border bg-muted/60 px-2 py-1 text-[12px]"
          />
          <ScrollArea className="flex-1">
          {shown.length === 0 && (
            <div className="px-2 py-1.5 text-[12px] text-muted-foreground">No matching variable</div>
          )}
          {shown.map((g) => (
            <Fragment key={g.id + g.title}>
              <div className="flex items-baseline gap-1.5 px-2 pb-0.5 pt-1.5">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {g.title}
                </span>
                {g.origin && (
                  <span className="text-[9.5px] text-muted-foreground/70 truncate">
                    {g.origin}
                  </span>
                )}
              </div>
              {g.fields.map((f) => (
                <button
                  key={f.insert}
                  title={f.insert}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onInsert(f.insert);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-muted/60 transition-colors"
                >
                  <span className="truncate">{f.name}</span>
                  {f.type && (
                    <span className="shrink-0 text-[9.5px] text-muted-foreground/70">{f.type}</span>
                  )}
                  <span className="flex-1" />
                  <code
                    className={cn(
                      "font-mono text-[9.5px] truncate max-w-[140px]",
                      varGroupAccent(g.id),
                    )}
                  >
                    {f.insert}
                  </code>
                </button>
              ))}
            </Fragment>
          ))}
          </ScrollArea>
        </div>
      )}
    </div>
  );
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
      <div className="grid gap-1">
        <Label>Run context</Label>
        <Textarea
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
      </div>
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
