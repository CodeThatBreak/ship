import "server-only";

import { db } from "../../../db/app";
import type { Database, QueryExecutor } from "../../../db/database";
import { EVENT_KIND, type EventKind } from "../../constants/vocabulary";
import { TRANSITION_MESSAGES } from "./constants/transitionMessages";
import type { TransitionRecord } from "./types/transitions";

/**
 * TransitionEvents — the one place that speaks about node status changes
 * (step-02 task 5). Every lifecycle/error emission the engine makes goes
 * through this class with the `EVENT_KIND` catalog, never a free-string
 * literal; the authority announces declared transitions through
 * {@link announcedTransition} using the per-key message templates.
 *
 * Must never: write node status (that is TransitionAuthority's alone), invent
 * event kinds outside `EVENT_KIND`, or emit on claims (the feed never showed
 * them and the retry call sites carry their own context).
 */
export class TransitionEvents {
  constructor(private readonly database: Database = db) {}

  /** A lifecycle line for an applied transition (message from the table's templates). */
  async announcedTransition(record: TransitionRecord, detail?: string, tx?: QueryExecutor): Promise<void> {
    const template = TRANSITION_MESSAGES[record.key];
    if (template == null) return; // silent key — the call site owns richer context
    const message = template
      .replace("{nodeKey}", record.nodeKey)
      .replace("{detail}", detail ?? "");
    await this.emit(record.flowId, record.nodeKey, EVENT_KIND.LIFECYCLE, message, {
      nodeKey: record.nodeKey,
      transition: record.key,
    }, tx);
  }

  /** A lifecycle event addressed by node key (resolves the node id). */
  async lifecycle(
    flowId: string,
    nodeKey: string | null,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    await this.emit(flowId, nodeKey, EVENT_KIND.LIFECYCLE, message, data);
  }

  /** An error event addressed by node key. */
  async error(
    flowId: string,
    nodeKey: string | null,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    await this.emit(flowId, nodeKey, EVENT_KIND.ERROR, message, data);
  }

  /** An MR-creation failure (the "Approve & create MR" retry hint). */
  async mrFailed(
    flowId: string,
    nodeKey: string | null,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    await this.emit(flowId, nodeKey, EVENT_KIND.MR_FAILED, message, data);
  }

  /**
   * The typed emission primitive — `kind` is constrained to the catalog.
   * Pass `tx` to join the emission into a caller's completion transaction
   * (step 06, Invariant 7 — the terminal write and its announcement land
   * atomically or not at all).
   */
  async emit(
    flowId: string,
    nodeKey: string | null,
    kind: EventKind,
    message: string,
    data?: Record<string, unknown>,
    tx?: QueryExecutor,
  ): Promise<void> {
    const nodeId = nodeKey
      ? (
          await this.database.prisma.node.findFirst({
            where: { flowId, nodeKey },
            select: { id: true },
          })
        )?.id ?? null
      : null;
    await this.database.emitEvent(flowId, nodeId, kind, message, data, tx);
  }
}
