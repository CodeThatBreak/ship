"use client";
import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { Input } from "../../ui/input";
import { Field, FieldLabel } from "../../ui/field";
import { Textarea } from "../../ui/textarea";
import { cn } from "../../../lib/utils";
import type { EditorNode } from "../types";
import { parseInputContract, type InputFieldRow } from "../ts-schema-lite";
import {
  buildStartContract,
  contractFieldsOf,
  contextFieldKeyOf,
  startFieldsToTs,
  startFieldTypeTs,
  withContextFields,
  type StartContractField,
} from "./start-contract";

const contractEqual = (a: StartContractField[], b: StartContractField[]): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** The start contract extras editor (the TS-lite row's label + default). */
export const StartContractEditor = ({
  node,
  onChange,
  taskFields,
}: {
  node: EditorNode;
  onChange: (p: Partial<EditorNode>) => void;
  taskFields?: { key: string; label: string; type: string; required?: boolean }[];
}) => {
  const config = node.config ?? {};
  const fields = contractFieldsOf(config);
  const waitFor = node.trigger.wait_for;
  const ctxKey = contextFieldKeyOf(waitFor);

  const [tsText, setTsText] = useState(() => startFieldsToTs(fields));

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

  const emitContract = (nextFields: StartContractField[]) => {
    if (contractEqual(nextFields, fields)) return;
    onChange({ config: { ...config, contract: nextFields } });
  };

  const commitTsText = (text: string) => {
    const lite = text.trim() ? parseInputContract(text) : { inputs: [], error: undefined };
    if (lite.error) return;
    const next = withContextFields(buildStartContract(lite.inputs, fields), waitFor);
    emitContract(next);
  };

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
    let v: unknown;
    if (raw.trim() === "") v = undefined;
    else if (type === "number")
      v = Number.isNaN(Number(raw)) ? raw : Number(raw);
    else if (type === "object" || type === "array") {
      try {
        v = JSON.parse(raw);
      } catch {
        v = raw;
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
                .map(
                  (f) =>
                    `${f.key}${f.required ? "" : "?"}: ${startFieldTypeTs(f.type)};`,
                );
              if (!members.length) return;
              const nextText = tsText.trim()
                ? `${tsText.trimEnd()}\n${members.join("\n")}`
                : members.join("\n");
              setTsText(nextText);
              commitTsText(nextText);
            }}
          >
            <Sparkles size={12} /> Seed from task context
          </Button>
          <span className="text-[11px] text-muted-foreground">
            adds fields for the {taskFields.length} {`{{task.*}}`} values the
            template&apos;s task type provides
          </span>
        </div>
      )}
      <Field>
        <FieldLabel htmlFor="node-run-context">Run context</FieldLabel>
        <Textarea
          id="node-run-context"
          value={tsText}
          onChange={(e) => setTsText(e.target.value)}
          onBlur={(e) => commitTsText(e.target.value)}
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
        <Card key={f.key} className="p-2.5 grid gap-1.5">
          <div className="flex items-center gap-2">
            <code className="font-mono text-[12.5px] text-info">{f.key}</code>
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
};
