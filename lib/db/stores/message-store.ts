import "server-only";

import { MessageRow } from "../rows";
import type { Database } from "../database";
import type { RowGateway } from "../rows";

export class MessageStore {
  constructor(
    private readonly db: Database,
    private readonly rows: RowGateway,
  ) {}

  addMessage(
    flowId: string,
    nodeKey: string | null,
    role: "user" | "assistant",
    content: string,
    thread?: string | null,
  ): void {
    this.db.run(
      `INSERT INTO messages (id, flow_id, node_key, thread, role, content, created_at)
       VALUES (?,?,?,?,?,?,?)`,
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
      `SELECT * FROM messages WHERE flow_id=? ORDER BY created_at, id`,
      flowId,
    );
  }
}
