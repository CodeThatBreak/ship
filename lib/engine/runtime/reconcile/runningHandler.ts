import "server-only";

import type { FlowRow } from "../../../db/rows";
import { RecoveryDriver } from "./recoveryDriver";

/**
 * RunningHandler — the `running` row of the reconcile matrix
 * (target-architecture §9, Invariant 3): a running node is alive while its
 * lease (`lease_until > now()`, DB-server time) is current; the walker only
 * hands this handler nodes whose lease expired or is missing (missing lease
 * on a running node IS expired — fail loud, no legacy backfill).
 *
 * Must never: compare a lease against app-server time, or throw (the driver
 * owns failure mapping).
 */
export class RunningHandler {
  constructor(private readonly recovery: RecoveryDriver) {}

  async handle(flow: FlowRow, node: { id: string; nodeKey: string }): Promise<void> {
    await this.recovery.recover(flow, node);
  }
}
