/**
 * The edge's label field: for a decision source, the branch label is
 * quick-picked from the source contract's choices (the picked chip
 * highlights); any other edge gets a free-form label (usually left empty).
 */
import { Button } from '../../../ui/button';
import { Field, FieldLabel } from '../../../ui/field';
import { Input } from '../../../ui/input';
import { cn } from "@/lib/utils";

export function EdgeLabelField({
  label,
  decision,
  choices,
  readonly,
  onLabelChange,
}: {
  label: string | null;
  decision: boolean;
  /** the decision's pickable branch labels (null for non-decision edges) */
  choices: { label: string; description?: string; condition?: string }[] | null;
  readonly: boolean;
  /** delegates to the parent's edge patch ({ label }) */
  onLabelChange: (label: string | null) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor="edge-label">
        Label{" "}
        {decision && (
          <span className="text-warning">
            — required for decision branches
          </span>
        )}
      </FieldLabel>
      {decision && choices && choices.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {choices.map((c) => (
            <Button
              key={c.label}
              disabled={readonly}
              title={c.description}
              onClick={() => onLabelChange(c.label)}
              variant="outline"
              size="xs"
              className={cn(
                "rounded-md text-[11.5px]",
                label === c.label
                  ? "border-violet-500 bg-violet-500/10 text-violet-300"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {c.label}
            </Button>
          ))}
        </div>
      )}
      <Input
        id="edge-label"
        value={label ?? ""}
        placeholder={
          decision
            ? "a choice of the decision node"
            : "label (decision branch)"
        }
        disabled={readonly}
        onChange={(ev) => onLabelChange(ev.target.value || null)}
      />
    </Field>
  );
}
