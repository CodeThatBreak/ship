import "server-only";

import { EventRow } from "../rows";
import type { Database } from "../database";
import type { RowGateway } from "../rows";

const EVENT_SELECT = `SELECT id, flow_id AS "flowId", node_id AS "nodeId", type, message, data,
                             created_at AS "createdAt" FROM events`;

export class EventStore {
  constructor(
    private readonly db: Database,
    private readonly rows: RowGateway,
  ) {}

  listEvents(flowId: string, after: string, limit: number) {
    return this.rows.all(
      EventRow,
      `${EVENT_SELECT} WHERE flow_id=$1 AND id > $2 ORDER BY created_at, id LIMIT $3`,
      flowId,
      after,
      limit,
    );
  }

  async listEventsTail(flowId: string, limit: number) {
    const rows = await this.rows.all(
      EventRow,
      `${EVENT_SELECT} WHERE flow_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2`,
      flowId,
      limit,
    );
    return rows.reverse();
  }

  async emitEvent(
    flowId: string,
    nodeId: string | null,
    type: string,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    await this.db.run(
      `INSERT INTO events (id, flow_id, node_id, type, message, data, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
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
