import "server-only";

import type { SplitChildLink } from "./splitChildPayload";
import type { SplitChildPayload } from "./splitChildPayload";

/**
 * The narrow linkage seam (decision 1): the split runtime's ONLY view of the
 * unit ↔ child-flow association. The default implementation
 * (`SplitLinkageStore`) derives it from `flows` (`parent_flow_id` +
 * `kind: 'split'` + the persisted child payload); a future `split_units`
 * table is a bounded swap behind this interface — the runtime logic never
 * touches the flows table for linkage itself.
 */
export interface SplitLinkIndex {
  /** the (parent, consumer) node's links, in unit (expansion) order */
  linksOf(parentFlowId: string, consumerNodeKey: string): Promise<SplitChildLink[]>;
  /** one child flow's payload, or null when the flow carries no split linkage */
  childPayloadOf(childFlowId: string): Promise<SplitChildPayload | null>;
  /** the consumer node that owns a unit key on this parent (the per-unit
   *  actions' optional addressing), or null when no split linkage carries it */
  consumerNodeOfUnit(parentFlowId: string, unitKey: string): Promise<string | null>;
}
