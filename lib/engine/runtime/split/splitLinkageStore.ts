import "server-only";

import { db } from "../../../db/app";
import type { SplitChildLink } from "./types/splitChildPayload";
import type { SplitChildPayload } from "./types/splitChildPayload";
import type { SplitLinkIndex } from "./types/splitLinkIndex";
import { parseSplitPayload } from "./utils/parseSplitPayload";

/**
 * SplitLinkageStore — the split runtime's unit ↔ child-flow linkage (step 07
 * decomposition of `SplitManager`; absorbs the former `FlowsSplitLinkIndex`):
 * the (parent, consumer) node's links in unit (expansion) order, one child's
 * payload, and the per-unit actions' consumer addressing, all derived from
 * the persisted child payloads.
 *
 * Invariants upheld:
 * - The child payload (`flows.trigger_payload`) is the linkage truth
 *   (decision 1: linkage rides the flow) — payloads are parsed at exactly
 *   this point and nowhere else; unparseable/foreign payloads read as "no
 *   split linkage" (null), never guessed.
 * - Links come back in unit (expansion) order (`unit.position`), the
 *   aggregate's deterministic unit order (decision 4).
 *
 * Must never:
 * - write flows/nodes rows or statuses — it is data access only;
 * - derive linkage from anything but the persisted child payload (a future
 *   `split_units` table swaps in behind the `SplitLinkIndex` interface
 *   without touching the runtime logic).
 */
export class SplitLinkageStore implements SplitLinkIndex {
  async linksOf(parentFlowId: string, consumerNodeKey: string): Promise<SplitChildLink[]> {
    const rows = await db.prisma.flow.findMany({
      where: { parentFlowId, kind: "split" }, select: { id: true, triggerPayload: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const links: SplitChildLink[] = [];
    for (const r of rows) {
      const payload = parseSplitPayload(r.triggerPayload);
      if (!payload || payload.parentNodeKey !== consumerNodeKey) continue;
      links.push({ childFlowId: r.id, unitKey: payload.unit.key, unit: payload.unit });
    }
    return links.sort((a, b) => a.unit.position - b.unit.position);
  }

  async childPayloadOf(childFlowId: string): Promise<SplitChildPayload | null> {
    const row = await db.prisma.flow.findUnique({ where: { id: childFlowId }, select: { triggerPayload: true } });
    return parseSplitPayload(row?.triggerPayload);
  }

  async consumerNodeOfUnit(parentFlowId: string, unitKey: string): Promise<string | null> {
    const rows = await db.prisma.flow.findMany({
      where: { parentFlowId, kind: "split" }, select: { triggerPayload: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    for (const r of rows) {
      const payload = parseSplitPayload(r.triggerPayload);
      if (payload?.unit.key === unitKey) return payload.parentNodeKey;
    }
    return null;
  }
}
