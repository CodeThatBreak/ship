import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { NodeContract } from "@/components/templateEditor/types";
import type { NodeTemplateKind } from "@/components/templateEditor/boilerplate";
import { DeclarativeConfigFields } from "@/components/templateEditor/DeclarativeConfigFields";
import { NODE_KINDS } from "../constants";
import type { NodeFormState } from "../types";

/**
 * The create/configure dialog's identity + definition form: name,
 * description, the kind select (locked while configuring a stored row) and
 * the kind's full definition, rendered by the same schema-driven field
 * machinery the builder drawer uses.
 */
export function NodeFormFields({
  form,
  hasId,
  onPatch,
  onKindChange,
  contract,
  secretNames,
}: {
  form: NodeFormState;
  /** true = configuring a stored node (the kind is locked) */
  hasId: boolean;
  onPatch: (patch: Partial<NodeFormState>) => void;
  /** kind switch — the dialog reseeds the definition + description */
  onKindChange: (kind: NodeTemplateKind) => void;
  contract: NodeContract | null;
  /** configured secret names — http nodes' {{secrets.NAME}} chips */
  secretNames: string[] | null;
}) {
  return (
    <div className="grid gap-3">
      <Field>
        <FieldLabel htmlFor="node-name">Name</FieldLabel>
        <Input
          id="node-name"
          value={form.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          placeholder="Summarize diff"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="node-description">Description</FieldLabel>
        <Input
          id="node-description"
          value={form.description}
          onChange={(e) => onPatch({ description: e.target.value })}
          placeholder="Shows up under the node name in the builder"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="node-kind">Kind</FieldLabel>
        <Select value={form.kind} onValueChange={(v) => { if (v) onKindChange(v); }} disabled={hasId}>
          <SelectTrigger id="node-kind" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NODE_KINDS.map((k) => (
              <SelectItem key={k.kind} value={k.kind}>{k.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!hasId && (
          <FieldDescription className="m-0">
            Seeded with a working {form.kind} boilerplate — tweak it or
            remap the inputs in the builder; nothing to write from scratch.
          </FieldDescription>
        )}
      </Field>

      <DeclarativeConfigFields
        kind={form.kind}
        config={form.config}
        contract={contract}
        secretNames={secretNames}
        onConfigChange={(config) => onPatch({ config })}
      />
    </div>
  );
}
