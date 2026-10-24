/**
 * Client-side grouping for the activity feed (Phase 1B/1C).
 *
 * Events arrive ordered by (created_at, id). We group them into run sections —
 * one per agent run — and within each section, coalesce consecutive same-type
 * events (thinking/assistant) into merged cards and pair tool_call start/finish
 * events into single invocation rows.
 *
 * New events carry `data.run_id`; for rows written before that, we fall back to
 * node + contiguity + a <30s gap heuristic.
 */

export interface FeedEvent {
  id: string;
  flow_id: string;
  node_id: string | null;
  type: string;
  message: string | null;
  data: string | null;
  created_at: string;
  // enriched client-side
  _data?: any;
  _nodeKey?: string;
}

export interface ToolCall {
  key: string; // callId or synthesized
  name: string;
  status: string;
  args?: string;
  result?: string;
  durationMs?: number;
  events: FeedEvent[]; // raw rows (start + finish)
}

export interface FeedGroup {
  key: string;
  kind: "thinking" | "assistant" | "status";
  text: string; // joined
  events: FeedEvent[];
  lastAt: string;
}

export type FeedItem =
  | { kind: "group"; group: FeedGroup }
  | { kind: "tool"; tool: ToolCall }
  | { kind: "event"; event: FeedEvent }; // lifecycle / error / pipeline etc.

export interface RunSection {
  key: string; // run_id or synthetic
  runId?: string;
  nodeId?: string | null;
  nodeKey?: string;
  label: string; // "plan", "build refine", …
  mode?: string;
  startedAt?: string;
  active: boolean;
  finished?: { durationMs?: number; tokens?: number; cost?: number; estimated?: boolean; model?: string };
  items: FeedItem[];
}

/** Groups a flat, ordered event list into run sections for the activity feed. */
export class EventGrouper {
  /** Consecutive events further apart than this start a new group/section. */
  static readonly GAP_MS = 30_000;

  private parseData(e: FeedEvent): any {
    if (e._data !== undefined) return e._data;
    try {
      e._data = e.data ? JSON.parse(e.data) : {};
    } catch {
      e._data = {};
    }
    return e._data;
  }

  private isStreamType(t: string): boolean {
    return t === "thinking" || t === "assistant" || t === "status";
  }

  /** Best-effort run identity for an event row. */
  private runIdOf(e: FeedEvent): string | undefined {
    return this.parseData(e).run_id ?? this.parseData(e).runId;
  }

  /** Group ordered events into run sections. */
  group(events: FeedEvent[], nodeKeysByNodeId?: Map<string, string>): RunSection[] {
    const sections: RunSection[] = [];
    let current: RunSection | null = null;

    const closeCurrent = () => {
      if (current) this.finalizeSection(current);
    };

    for (const raw of events) {
      const e = raw as FeedEvent;
      const d = this.parseData(e);
      e._nodeKey = e.node_id ? nodeKeysByNodeId?.get(e.node_id) : undefined;
      const runId = this.runIdOf(e);

      // ── section boundaries ─────────────────────────────────────────────
      const startsRun = e.type === "lifecycle" && /started/.test(e.message ?? "") && runId;
      if (startsRun) {
        closeCurrent();
        current = {
          key: runId,
          runId,
          nodeId: e.node_id,
          nodeKey: e._nodeKey,
          label: (e.message ?? "").replace(/\s*started.*$/, ""),
          mode: d.mode,
          startedAt: e.created_at,
          active: true,
          items: [],
        };
        sections.push(current);
        continue;
      }

      // attach to current run section when possible
      if (runId && current?.runId === runId) {
        this.addToSection(current, e);
        if (e.type === "lifecycle" && /finished/.test(e.message ?? "")) {
          current.active = false;
          current.finished = {
            durationMs: d.durationMs,
            tokens: d.tokens,
            cost: d.cost,
            estimated: d.estimated,
            model: d.model,
          };
          closeCurrent();
          current = null;
        } else if (e.type === "error") {
          current.active = false;
          closeCurrent();
          current = null;
        }
        continue;
      }
      if (runId) {
        // event belongs to a run we didn't see the start of (page loaded mid-run
        // with a limited backlog, or start row fell outside the 500-event window)
        const existing = sections.find((s) => s.runId === runId && s.active);
        if (existing) {
          this.addToSection(existing, e);
          continue;
        }
        current = {
          key: runId,
          runId,
          nodeId: e.node_id,
          nodeKey: e._nodeKey,
          label: e._nodeKey ?? "run",
          startedAt: e.created_at,
          active: true,
          items: [],
        };
        sections.push(current);
        this.addToSection(current, e);
        continue;
      }

      // legacy rows without run_id: fold into the current section if it's the
      // same node and within the gap window, else a loose section
      const ts = Date.parse(e.created_at);
      const last = current?.items.length ? this.lastEvent(current)?.created_at : current?.startedAt;
      const lastTs = last ? Date.parse(last) : 0;
      if (current && e.node_id === current.nodeId && ts - lastTs < EventGrouper.GAP_MS) {
        this.addToSection(current, e);
        continue;
      }
      closeCurrent();
      current = {
        key: `loose_${e.id}`,
        nodeId: e.node_id,
        nodeKey: e._nodeKey,
        label: e._nodeKey ? `${e._nodeKey} activity` : "flow activity",
        startedAt: e.created_at,
        active: false,
        items: [],
      };
      sections.push(current);
      this.addToSection(current, e);
    }
    closeCurrent();
    return sections;
  }

  private lastEvent(s: RunSection): FeedEvent | undefined {
    for (let i = s.items.length - 1; i >= 0; i--) {
      const it = s.items[i];
      if (it.kind === "event") return it.event;
      if (it.kind === "group") return it.group.events[it.group.events.length - 1];
      if (it.kind === "tool") return it.tool.events[it.tool.events.length - 1];
    }
    return undefined;
  }

  private addToSection(s: RunSection, e: FeedEvent): void {
    const d = this.parseData(e);
    if (this.isStreamType(e.type)) {
      const last = s.items[s.items.length - 1];
      const ts = Date.parse(e.created_at);
      if (
        last?.kind === "group" &&
        last.group.kind === e.type &&
        ts - Date.parse(last.group.lastAt) < EventGrouper.GAP_MS
      ) {
        last.group.text += e.type === "status" ? `\n${e.message}` : (e.message ?? "");
        last.group.events.push(e);
        last.group.lastAt = e.created_at;
      } else {
        s.items.push({
          kind: "group",
          group: {
            key: e.id,
            kind: e.type as FeedGroup["kind"],
            text: e.message ?? "",
            events: [e],
            lastAt: e.created_at,
          },
        });
      }
      return;
    }
    if (e.type === "tool") {
      const callId = d.callId ?? d.call_id;
      if (callId) {
        // pair with an existing invocation row (same callId) in this section
        for (let i = s.items.length - 1; i >= 0; i--) {
          const it = s.items[i];
          if (it.kind === "tool" && it.tool.key === callId) {
            it.tool.events.push(e);
            it.tool.status = d.status ?? it.tool.status;
            if (d.args != null) it.tool.args = d.args;
            if (d.result != null) it.tool.result = d.result;
            if (d.durationMs != null) it.tool.durationMs = d.durationMs;
            return;
          }
        }
        s.items.push({
          kind: "tool",
          tool: {
            key: callId,
            name: d.name ?? (e.message ?? "tool").split(":")[0],
            status: d.status ?? "started",
            args: d.args,
            result: d.result,
            durationMs: d.durationMs,
            events: [e],
          },
        });
        return;
      }
      // legacy tool row (no callId) — keep as standalone invocation
      s.items.push({
        kind: "tool",
        tool: {
          key: e.id,
          name: (e.message ?? "tool").split(":")[0],
          status: (e.message ?? "").split(":")[1]?.trim() || "started",
          args: d.args,
          events: [e],
        },
      });
      return;
    }
    s.items.push({ kind: "event", event: e });
  }

  /** No-op pass kept for symmetry/future cleanup (sections are finalized eagerly). */
  private finalizeSection(_s: RunSection): void {}
}

export const eventGrouper = new EventGrouper();

/**
 * Flow-level events (node_id = null) are emitted for the whole flow even though
 * most of them concern a single stage. Emitters that know the owning node
 * stamp it into the event data at emit time (§3.3) — no message-text guessing
 * here. Returns null for generic events (infra errors and the like) that every
 * tab should still see.
 */
export function flowEventNodeKeys(e: FeedEvent): string[] | null {
  if (e.node_id != null) return null; // node-scoped — already filtered by the caller

  let data: any = {};
  try {
    data = e.data ? JSON.parse(e.data) : {};
  } catch {
    data = {};
  }
  return typeof data?.nodeKey === "string" && data.nodeKey ? [data.nodeKey] : null;
}
