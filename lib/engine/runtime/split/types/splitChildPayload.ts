import "server-only";

/** The split child's trigger payload — persisted on the child flow row as
 *  `trigger_payload` (decision 1: linkage rides the flow). `parentNodeKey`
 *  names the consumer node on the parent that owns this child; `unit` is the
 *  serialized SplitUnit, rendered to the child as `{{input.unit.*}}`.
 *  `position` is the unit's index in the expansion that created the child —
 *  the aggregate's deterministic unit order (decision 4). */
export interface SplitChildPayload {
  parentNodeKey: string;
  unit: {
    key: string;
    title: string;
    dependsOn: string[];
    item: unknown;
    position: number;
  };
}

/** One derived unit ↔ child-flow association (the linkage row). */
export interface SplitChildLink {
  childFlowId: string;
  unitKey: string;
  unit: SplitChildPayload["unit"];
}
