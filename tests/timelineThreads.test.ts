/**
 * The chat feed's thread filtering (the plan's per-sub-plan-refinement
 * tabs): `selectNodeMessages` splits the node's transcript into the main
 * conversation and the branch threads, keeping the flow-level and
 * node-scoping rules unchanged.
 *
 * Pure modules — no DB, no React; only the `@` alias (vitest.config.mts).
 */
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/hooks/useFlowChat";
import { selectNodeMessages } from "@/components/chat/timeline";

// ── fixtures ────────────────────────────────────────────────────────────────

const msg = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: "user",
  content: id,
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

const MAIN: string | null = null;

describe("selectNodeMessages — the thread split", () => {
  const transcript = [
    msg("flow-hello"),                                  // flow-level, unthreaded
    msg("main-1", { node_key: "plan" }),                // node-level, unthreaded
    msg("auth-1", { node_key: "plan", thread: "auth" }),
    msg("main-2", { node_key: "plan", thread: null }),
    msg("build-1", { node_key: "build", thread: "auth" }), // another node's thread
    msg("legacy-1", { node_key: "plan" }),              // row without the thread field
  ];

  it("main conversation: the node's unthreaded turns + flow-level turns, no thread turns", () => {
    expect(selectNodeMessages(transcript, "plan", MAIN).map((m) => m.id)).toEqual([
      "flow-hello",
      "main-1",
      "main-2",
      "legacy-1",
    ]);
  });

  it("a refinement thread: only that node's turns of that thread", () => {
    expect(selectNodeMessages(transcript, "plan", "auth").map((m) => m.id)).toEqual([
      "auth-1",
    ]);
  });

  it("node scoping still applies inside a thread", () => {
    expect(selectNodeMessages(transcript, "build", "auth").map((m) => m.id)).toEqual([
      "build-1",
    ]);
  });

  it("undefined transcript → empty for both", () => {
    expect(selectNodeMessages(undefined, "plan", MAIN)).toEqual([]);
    expect(selectNodeMessages(undefined, "plan", "auth")).toEqual([]);
  });
});
