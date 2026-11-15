import "server-only";

import { MessageRow } from "../rows";
import type { Database } from "../database";

/** Chat thread between the developer and the node agents. */
export class MessageStore {
  constructor(private readonly db: Database) {}

  async addMessage(
    flowId: string,
    nodeKey: string | null,
    role: "user" | "assistant",
    content: string,
    thread?: string | null,
  ): Promise<void> {
    await this.db.prisma.message.create({
      data: {
        id: this.db.uid("msg_"),
        flowId,
        nodeKey,
        thread: thread ?? null,
        role: role as never,
        content,
        createdAt: new Date(),
      },
    });
  }

  async listMessages(flowId: string) {
    const rows = await this.db.prisma.message.findMany({
      where: { flowId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const decoded: MessageRow[] = [];
    for (const raw of rows) {
      const result = MessageRow.safeParse(raw);
      if (result.success) decoded.push(result.data);
      else console.error("[rows] skipping undecodable row", { rowId: raw.id, issues: result.error.issues });
    }
    return decoded;
  }
}
