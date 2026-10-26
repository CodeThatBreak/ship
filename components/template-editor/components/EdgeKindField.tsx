/**
 * The edge's kind field (next / loop): the labeled select and the trailing
 * description for the picked kind. The stored values stay "next"/"loop".
 */
import { Field, FieldDescription, FieldLabel } from "../../ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { SelectOption } from "../NodeConfigurator";

/** The edge kinds the editor can author (the stored values stay these strings). */
const EDGE_KINDS = ["next", "loop"] as const;

/** Edge kinds as labeled options (the kind select's friendly labels). */
export const EDGE_KIND_OPTIONS: Record<string, { label: string; description: string }> = {
  next: {
    label: "Next",
    description:
      "Runs the target after the source finishes; its output joins the target's input.",
  },
  loop: {
    label: "Loop",
    description:
      "Runs the target again after it finishes, up to the target's retry limit.",
  },
};

export function EdgeKindField({
  kind,
  readonly,
  onKindChange,
}: {
  kind: string;
  readonly: boolean;
  /** delegates to the parent's edge patch ({ kind }) */
  onKindChange: (kind: string) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor="edge-kind">Kind</FieldLabel>
      <Select
        value={kind}
        disabled={readonly}
        onValueChange={(v) => {
          if (v != null) onKindChange(v);
        }}
      >
        <SelectTrigger id="edge-kind" className="w-full rounded-lg border-border bg-card">
          <SelectValue>
            {EDGE_KIND_OPTIONS[kind]?.label ?? kind}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {EDGE_KINDS.map((k) => (
            <SelectItem key={k} value={k}>
              <SelectOption
                label={EDGE_KIND_OPTIONS[k]?.label ?? k}
                description={EDGE_KIND_OPTIONS[k]?.description ?? ""}
              />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>
        {kind === "loop"
          ? "A loop edge runs the target again after it finishes, up to the target's retry limit."
          : "Runs the target when the source finishes."}
      </FieldDescription>
    </Field>
  );
}
