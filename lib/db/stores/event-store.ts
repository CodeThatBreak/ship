import "server-only";

import { EventRow } from "../rows";
import type { Database } from "../database";
import type { RowGateway } from "../rows";

export class EventStore {
  constructor(
    private readonly db: Database,
    private readonly rows: RowGateway,
  ) {}

  listEvents(flowId: string, after: string, limit: number) {
    return this.rows.all(
      EventRow,
      `SELECT * FROM events WHERE flow_id=? AND id > ? ORDER BY created_at, id LIMIT ?`,
      flowId,
      after,
      limit,
    );
  }

  listEventsTail(flowId: string, limit: number) {
    const rows = this.rows.all(
      EventRow,
      `SELECT * FROM events WHERE flow_id=? ORDER BY created_at DESC, id DESC LIMIT ?`,
      flowId,
      limit,
    );
    return rows.reverse();
  }

  emitEvent(
    flowId: string,
    nodeId: string | null,
    type: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.db.run(
      `INSERT INTO events (id, flow_id, node_id, type, message, data, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      this.db.uid("ev_"),
      flowId,
      nodeId,
      type,
      message,
      data ? JSON.stringify(data) : null,
      this.db.now(),
    );
  }
}
