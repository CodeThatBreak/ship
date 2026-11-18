import { expect } from "vitest";
import type { TransitionAuthority } from "@/lib/engine/runtime/transitions/nodeTransitions";
import type { TransitionRow } from "@/lib/engine/runtime/transitions/types/transitions";
import { TRANSITION_TABLE } from "@/lib/engine/runtime/transitions/constants/transitionTable";
import { isClaimKey } from "@/lib/engine/runtime/transitions/utils/transitionLookup";

/**
 * In-memory transition-log assert (engine-overhaul step 02, task 6): every
 * transition the authority applied for a flow (or across all flows when no
 * id is given) must resolve against the declared table — the runtime mirror
 * of the `noRawNodeStatusWrite` source scan, catching undeclared runtime
 * paths the scan can't see. Call it at the end of an engine test that drove
 * real transitions.
 */
export function expectTransitionsDeclared(authority: TransitionAuthority, flowId?: string): void {
  const records = authority.records(flowId);
  expect(records.length, "no transitions were recorded — did this test drive the engine?").toBeGreaterThan(0);
  for (const record of records) {
    const row: TransitionRow | undefined = TRANSITION_TABLE[record.key];
    // the key exists in the table…
    expect(row, `undeclared transition key "${record.key}" (node ${record.nodeKey})`).toBeDefined();
    // …the recorded target is one of its declared targets…
    expect(
      row?.to.includes(record.to),
      `transition "${record.key}" recorded target "${record.to}" (node ${record.nodeKey})`,
    ).toBe(true);
    // …and claims carry their attempt token
    if (isClaimKey(record.key)) {
      expect(record.attemptId, `claim "${record.key}" (node ${record.nodeKey}) recorded no attempt`).toMatch(/^att_/);
    }
  }
}
