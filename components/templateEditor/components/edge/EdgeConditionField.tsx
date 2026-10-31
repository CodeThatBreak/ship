/**
 * The edge's activation condition: the field label, the structured condition
 * builder (its raw JSONata lands in the edge patch) and the trailing hint.
 * The vocabulary (varGroups) is derived by the parent — an edge condition
 * sees the whole flow context at traversal time.
 */
import { ConditionBuilder } from '../../conditionBuilder/conditionBuilderExports';
import type { VarGroup } from '../../variables';

export function EdgeConditionField({
  condition,
  varGroups,
  templateId,
  readonly,
  onConditionChange,
}: {
  /** the edge's raw condition (null / "" = none — always runs) */
  condition: string | null;
  /** JSONata-stripped variable groups (the builder's pickers' lists) */
  varGroups: VarGroup[];
  templateId: string;
  readonly: boolean;
  /** delegates to the parent's edge patch ({ condition }) */
  onConditionChange: (raw: string | null) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <label className="text-xs text-muted-foreground">
        Condition — when does this edge activate?
      </label>
      <ConditionBuilder
        value={condition}
        varGroups={varGroups}
        templateId={templateId}
        scope="context"
        placeholder="nodes.build.output.mr_url"
        disabled={readonly}
        onChange={onConditionChange}
      />
      <p className="text-[11px] text-muted-foreground m-0">
        The edge runs only when its condition passes — leave it empty to
        always run. It&apos;s checked against the flow&apos;s context as the
        source node finishes.
      </p>
    </div>
  );
}
