"use client";
/**
 * The node configurator's Trigger tab: the trigger type, the debounced quiet
 * period, the auto trigger's wait-for event (grouped picker), and the type-
 * dependent extras — the webhook request example and the timer delay.
 */
import { Input } from "../../ui/input";
import { Field, FieldDescription, FieldLabel } from "../../ui/field";
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockHeader, CodeBlockTitle } from "../../ui/code-block";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "../../ui/select";
import { TRIGGER_TYPES, WAIT_FOR_GROUPS, WAIT_FOR_SOURCES } from "../constants";
import type { EditorNode } from "../types";
import { SelectOption } from "../ConfigFieldRow";
import {
  contractFieldsOf,
  contextFieldKeyOf,
  withContextFields,
} from "./start-contract";

export function TriggerTab({
  node,
  onChange,
}: {
  node: EditorNode;
  onChange: (p: Partial<EditorNode>) => void;
}) {
  const t = node.trigger;
  const source = WAIT_FOR_SOURCES.find((w) => w.value === t.wait_for);
  const contractFields = contractFieldsOf(node.config);
  return (
    <div className="grid gap-3">
      <Field>
        <FieldLabel htmlFor="node-trigger-type">Trigger type</FieldLabel>
        <Select
          value={t.type}
          onValueChange={(v) => {
            const next = v ?? t.type;
            if (next === t.type) return;
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
            onValueChange={(v) => {
              const wait_for = (v as string) || undefined;
              const nextContract = withContextFields(contractFields, wait_for);
              const contractPatch =
                JSON.stringify(nextContract) === JSON.stringify(contractFields)
                  ? {}
                  : {
                      config: {
                        ...(node.config ?? {}),
                        contract: nextContract,
                      },
                    };
              onChange({
                trigger: { ...t, wait_for },
                ...contractPatch,
              });
            }}
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
function WebhookRequestExample({
  fields,
}: {
  fields: { key: string; type: string }[];
}) {
  const sampleValue = (type: string): unknown =>
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
