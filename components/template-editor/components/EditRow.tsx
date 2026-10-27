"use client";
/**
 * The editing row: field name + the grouped source picker (raw JSONata as
 * the separated advanced item). The row keeps its edits local — nothing
 * lands in input_map until the Add button commits them (Cancel closes
 * without writing); the popover hugs the field's right edge so it fits the
 * narrow side panel.
 */
import { useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { slugOk, type InputMapEdit, type SourceField } from "../hooks/use-input-map";
import {
  FLOW_REPO_FIELDS,
  asJsonataGroups,
  buildVarGroups,
  conditionVarGroups,
  resolveMapExpr,
  type UpstreamVarSource,
} from "../variables";
import { ExpressionInput } from "../condition-builder";

/** the advanced picker item: raw JSONata typed into the expression box */
const CUSTOM_SOURCE = "__custom__";

export function EditRow({
  editing,
  upstream,
  taskFields,
  triggerFields,
  templateId,
  onCommit,
  onCancel,
  onRemove,
}: {
  editing: InputMapEdit;
  upstream: UpstreamVarSource[];
  taskFields?: SourceField[];
  triggerFields?: SourceField[];
  templateId?: string;
  onCommit: (name: string, expr: string) => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  // the draft — committed by Add, discarded by Cancel
  const [name, setName] = useState(editing.name);
  const [expr, setExpr] = useState(editing.expr);
  const known = resolveMapExpr(expr, { upstream, taskFields, triggerFields });
  const custom = known == null;
  const trimmedName = name.trim();
  const nameBad = trimmedName !== "" && !slugOk(trimmedName);
  const addable = trimmedName !== "" && !nameBad && expr.trim() !== "";
  return (
    <div className="grid gap-1.5 px-3 py-2 bg-info/[0.04] first:rounded-t-lg last:rounded-b-lg">
      <div className="grid grid-cols-[minmax(0,150px)_1fr] gap-1.5 items-start">
        <div className="grid gap-1">
          <Input
            value={name}
            disabled={editing.fixedName}
            placeholder="field name"
            className="font-mono text-[12px]"
            aria-label="Field name"
            onChange={(e) => setName(e.target.value)}
          />
          {nameBad && (
            <p className="text-[10.5px] text-warning m-0">
              lowercase letters, digits and _ — starts with a letter
            </p>
          )}
        </div>
        <div className="grid gap-1">
          <Select
            value={custom ? CUSTOM_SOURCE : expr.trim()}
            onValueChange={(v) => setExpr(v && v !== CUSTOM_SOURCE ? v : "")}
          >
            <SelectTrigger
              className="w-full rounded-lg border-border bg-card font-mono text-[12px]"
              aria-label="Mapping source"
            >
              <SelectValue placeholder="Pick a source…" />
            </SelectTrigger>
            <SelectContent>
              {upstream.map((src) => (
                <SelectGroup key={src.key}>
                  <SelectLabel>Upstream: {src.label}</SelectLabel>
                  {src.fields.map((f) => (
                    <SelectItem
                      key={`nodes.${src.key}.output.${f.name}`}
                      value={`nodes.${src.key}.output.${f.name}`}
                    >
                      <span className="font-mono text-[11.5px]">{f.name}</span>
                      {f.type && (
                        <span className="text-[9.5px] text-muted-foreground/70 ml-1.5">
                          {f.type}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
              {taskFields && taskFields.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Task context</SelectLabel>
                  {taskFields.map((f) => (
                    <SelectItem key={`task.${f.key}`} value={`task.${f.key}`}>
                      <span className="font-mono text-[11.5px]">{f.key}</span>
                      {f.label && f.label !== f.key && (
                        <span className="text-[9.5px] text-muted-foreground/70 ml-1.5">
                          {f.label}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {triggerFields && triggerFields.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Trigger payload</SelectLabel>
                  {triggerFields.map((f) => (
                    <SelectItem
                      key={`trigger.payload.${f.key}`}
                      value={`trigger.payload.${f.key}`}
                    >
                      <span className="font-mono text-[11.5px]">{f.key}</span>
                      {f.label && f.label !== f.key && (
                        <span className="text-[9.5px] text-muted-foreground/70 ml-1.5">
                          {f.label}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              <SelectGroup>
                <SelectLabel>Flow / Repo</SelectLabel>
                {FLOW_REPO_FIELDS.map((f) => (
                  <SelectItem key={f.path} value={f.path}>
                    <span className="font-mono text-[11.5px]">{f.path}</span>
                    <span className="text-[9.5px] text-muted-foreground/70 ml-1.5">
                      {f.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Advanced</SelectLabel>
                <SelectItem value={CUSTOM_SOURCE}>Custom expression (JSONata)</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          {custom && (
            <ExpressionInput
              value={expr}
              autoFocus
              align="right"
              varGroups={asJsonataGroups(conditionVarGroups(
                buildVarGroups({ taskFields, triggerFields, upstream }),
              ))}
              templateId={templateId}
              scope="context"
              rows={1}
              placeholder="JSONata — e.g. nodes.build.output.plan.items[0]"
              onChange={setExpr}
            />
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          className="h-7 px-2.5"
          disabled={!addable}
          title={addable ? undefined : "Pick a field name and a source first"}
          onClick={() => onCommit(name, expr)}
        >
          <Check size={12} /> Add mapping
        </Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onCancel}>
          Cancel
        </Button>
        {onRemove && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            title="Remove mapping — falls back to the inherited value"
            onClick={onRemove}
          >
            <Trash2 size={12} /> Remove
          </Button>
        )}
      </div>
    </div>
  );
}
