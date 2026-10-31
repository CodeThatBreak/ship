/**
 * T4/T4b (node-definition refactor, phase 5): the capability-gated role
 * router + the AgentRunNode tier.
 *
 *  - the router routes a def's chat/converse/preview affordances by role +
 *    capability — a kind that never opts in (decision) declines chat exactly
 *    like the old root default, and runner-free leaves (start) get no roles;
 *  - the tier's default chat is the rerun-with-feedback recipe, remappable
 *    onto each node's own guidance field.
 *
 * Runs against an isolated temp SQLite DB: DATABASE_PATH is read lazily by
 * lib/config.ts, so setting it before the first `db` import isolates the
 * singleton (AGENTS.md §1 — never a real database). No node run touches the
 * DB here, but the imports hoist it — dynamic imports keep the order.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Must run before any `../../../*/db` import touches the connection.
process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-node-roles-")),
  "test.db",
);

const { nodeRoles } = await import("./node-roles");
const { AgentRunNode } = await import("./agent-run-node");
// the registry instantiates every builtin on first load — resolve its import
// cycle from here (not from a mid-evaluation node class) so all classes are
// fully initialized before any is constructed
await import("../registry");
const { PlanNode } = await import("../kinds/plan/plan-node");
const { StartNode } = await import("../kinds/start/start-node");
const { DecisionTemplateNode } = await import("../kinds/decision/decision-node");
const { AgentTemplateNode } = await import("../kinds/agent/agent-node");
const { HttpTemplateNode } = await import("../kinds/http/http-node");
const { ScriptTemplateNode } = await import("../kinds/script/script-node");

import { z } from "zod";
import type { FlowCtx } from "./run-context";
import type { RunOutcome } from "./node-definition";

/** A template-row subject: id/name/config mirror a node_templates row. */
const tmpl = (id: string, name: string, config: unknown = {}) => ({ id, name, description: null, config });

const planDef = new PlanNode();
const startDef = new StartNode();
const decisionDef = new DecisionTemplateNode(tmpl("nt_d", "Decide", { choices: [{ label: "a" }, { label: "b" }] }));
const agentDef = new AgentTemplateNode(tmpl("nt_a", "Agent"));
const httpDef = new HttpTemplateNode(tmpl("nt_h", "Call"));
const scriptDef = new ScriptTemplateNode(tmpl("nt_s", "Script"));

describe("NodeRoleRouter — chat refine routing (T4)", () => {
  it("routes defs that opt in via capabilities + role", () => {
    const chat = planDef as unknown as { chat?: unknown; turn?: unknown };
    expect(nodeRoles.chatRefinerOf(planDef)).not.toBeNull();
    expect(typeof chat.chat).toBe("function");
    expect(typeof chat.turn).toBe("function");
  });

  it("declines a kind whose capabilities never opted in — even with a chat method", () => {
    // the agent-run tier gives every member a default chat; the router still
    // refuses a decision kind — its pick is confirmed on the card, not chat
    expect(nodeRoles.chatRefinerOf(decisionDef)).toBeNull();
    const decision = decisionDef as unknown as { chat?: unknown };
    expect(typeof decision.chat).toBe("function");
    expect(nodeRoles.chatRefinerOf(startDef)).toBeNull();
    expect(nodeRoles.chatRefinerOf(httpDef)).toBeNull();
    expect(nodeRoles.chatRefinerOf(scriptDef)).toBeNull();
  });
});

describe("NodeRoleRouter — conversational (chatOnly) routing", () => {
  it("routes agent-bearing defs, declines the runner-free leaves", () => {
    expect(nodeRoles.converserOf(planDef)).not.toBeNull();
    expect(nodeRoles.converserOf(agentDef)).not.toBeNull();
    expect(nodeRoles.converserOf(decisionDef)).not.toBeNull();
    expect(nodeRoles.converserOf(startDef)).toBeNull();
    expect(nodeRoles.converserOf(httpDef)).toBeNull();
    expect(nodeRoles.converserOf(scriptDef)).toBeNull();
  });

  it("the no-agent reply names the node's label", () => {
    expect(nodeRoles.noAgentReply("Build")).toBe(
      "There's no Build agent to chat with yet — run the step first (or switch on refine mode), then ask me anything.",
    );
  });
});

describe("NodeRoleRouter — prompt preview routing", () => {
  it("routes the serving built-ins, declines kinds without one", () => {
    for (const def of [planDef]) {
      expect(nodeRoles.promptPreviewerOf(def)).not.toBeNull();
    }
    // agent kinds publish no preview yet (declarative preview pending I10)
    expect(nodeRoles.promptPreviewerOf(agentDef)).toBeNull();
    expect(nodeRoles.promptPreviewerOf(startDef)).toBeNull();
    expect(nodeRoles.promptPreviewerOf(httpDef)).toBeNull();
    expect(nodeRoles.promptPreviewerOf(scriptDef)).toBeNull();
    expect(nodeRoles.promptPreviewerOf(decisionDef)).toBeNull();
  });
});

describe("AgentRunNode — the run/run-converse membership (T4b)", () => {
  it("plan stays in the tier; start stays a runner-free leaf", () => {
    expect(planDef).toBeInstanceOf(AgentRunNode);
    expect(startDef).not.toBeInstanceOf(AgentRunNode);
    expect(agentDef).toBeInstanceOf(AgentRunNode);
  });
});

/**
 * A minimal tier member: the schemas/routing contract only — run() captures
 * the input `chat()` hands over (no DB row involved; nodeConfig is stubbed).
 */
class RecipeNode extends AgentRunNode<Record<string, unknown>, Record<string, unknown>> {
  readonly key = "recipe";
  readonly label = "Recipe";
  readonly promptKeys = [] as const;
  readonly order = 999;
  readonly inputSchema = z.looseObject({}) as z.ZodType<Record<string, unknown>>;
  readonly outputSchema = z.looseObject({}) as z.ZodType<Record<string, unknown>>;

  seen: Record<string, unknown>[] = [];

  protected override nodeConfig(_ctx: FlowCtx): Record<string, unknown> {
    return {};
  }

  async run(ctx: FlowCtx, input: Record<string, unknown>): Promise<RunOutcome> {
    void ctx;
    this.seen.push(input);
    return { status: "done", output: {}, event: "recipe done", reply: "ok" };
  }

  async recover(): Promise<boolean> {
    return false;
  }
}

const ctxForChat = (): FlowCtx => ({}) as FlowCtx;

describe("AgentRunNode — the rerun-with-feedback chat recipe (T4b)", () => {
  it("a chat message reruns the node with { feedback, model }", async () => {
    const def = new RecipeNode();
    const reply = await def.chat(ctxForChat(), "tighten the checks");
    expect(reply).toBe("ok");
    expect(def.seen).toEqual([{ feedback: "tighten the checks", model: null }]);
  });

  it("the model override rides the chat input", async () => {
    const def = new RecipeNode();
    await def.chat(ctxForChat(), "tighten", "gpt-5");
    expect(def.seen.pop()).toEqual({ feedback: "tighten", model: "gpt-5" });
  });

  it("the recipe remaps onto the node's own guidance field", async () => {
    class ReviewStyleNode extends RecipeNode {
      protected override chatInput(content: string, model?: string): Record<string, unknown> {
        return { instructions: content, model: model ?? null };
      }
    }
    const def = new ReviewStyleNode();
    await def.chat(ctxForChat(), "focus on the auth flow");
    expect(def.seen.pop()).toEqual({ instructions: "focus on the auth flow", model: null });
  });
});
