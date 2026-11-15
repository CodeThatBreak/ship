import "server-only";

import { MessageRow } from "../rows";
import type { Database } from "../database";
import type { RowGateway } from "../rows";

export class MessageStore {
  constructor(
    private readonly db: Database,
    private readonly rows: RowGateway,
  ) {}

  async addMessage(
    flowId: string,
    nodeKey: string | null,
    role: "user" | "assistant",
    content: string,
    thread?: string | null,
  ): Promise<void> {
    await this.db.run(
      `INSERT INTO messages (id, flow_id, node_key, thread, role, content, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      this.db.uid("msg_"),
      flowId,
      nodeKey,
      thread ?? null,
      role,
      content,
      this.db.now(),
    );
  }

  listMessages(flowId: string) {
    return this.rows.all(
      MessageRow,
      `SELECT id, flow_id AS "flowId", node_key AS "nodeKey", thread, role, content,
              created_at AS "createdAt"
       FROM messages WHERE flow_id=$1 ORDER BY created_at, id`,
      flowId,
    );
  }
}
