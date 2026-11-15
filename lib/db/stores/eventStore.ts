import "server-only";

import { EventRow } from "../rows";
import type { Database } from "../database";

/** Append-only event log (drives the live activity feed + polling). */
export class EventStore {
  constructor(private readonly db: Database) {}

  async listEvents(flowId: string, after: string, limit: number) {
    const rows = await this.db.prisma.event.findMany({
      where: { flowId, id: { gt: after } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    const decoded: EventRow[] = [];
    for (const raw of rows) {
      const result = EventRow.safeParse(raw);
      if (result.success) decoded.push(result.data);
      else console.error("[rows] skipping undecodable row", { rowId: raw.id, issues: result.error.issues });
    }
    return decoded;
  }

  async listEventsTail(flowId: string, limit: number) {
    const rows = await this.db.prisma.event.findMany({
      where: { flowId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    const decoded: EventRow[] = [];
    for (const raw of rows) {
      const result = EventRow.safeParse(raw);
      if (result.success) decoded.push(result.data);
      else console.error("[rows] skipping undecodable row", { rowId: raw.id, issues: result.error.issues });
    }
    return decoded.reverse();
  }

  async emitEvent(
    flowId: string,
    nodeId: string | null,
    type: string,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    await this.db.prisma.event.create({
      data: {
        id: this.db.uid("ev_"),
        flowId,
        nodeId,
        type,
        message,
        data: (data ?? null) as never,
        createdAt: new Date(),
      },
    });
  }
}
