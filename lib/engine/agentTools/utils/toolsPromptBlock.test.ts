import { describe, expect, it } from "vitest";
import { agentToolsBlock, redactCapabilityToken, TOKEN_MASK } from "./toolsPromptBlock";
import { AGENT_TOKEN_ENV } from "../constants/agentTools";
import type { ToolDescriptor } from "../types/tools";

const TOOLS: readonly ToolDescriptor[] = [
  { name: "read_flow_state", description: "getFlowState — read the flow's live state" },
];

describe("agentToolsBlock", () => {
  it("is empty without a base url or tools", () => {
    expect(agentToolsBlock({ baseUrl: "", flowId: "f", nodeKey: "n", token: "t", tools: TOOLS })).toBe("");
    expect(agentToolsBlock({ baseUrl: "https://x", flowId: "f", nodeKey: "n", token: "t", tools: [] })).toBe("");
  });

  it("never inlines a live token — it references the injected env var for every runtime", () => {
    const block = agentToolsBlock({
      baseUrl: "https://x/",
      flowId: "flow-1",
      nodeKey: "build",
      token: "tok-abc123",
      tools: TOOLS,
    });
    expect(block).toContain("POST https://x/api/flows/flow-1/nodes/build/agent-tools");
    expect(block).toContain(`Authorization: Bearer $${AGENT_TOKEN_ENV} (injected into your run environment)`);
    expect(block).not.toContain("tok-abc123"); // the token never enters prompt text
    expect(block).toContain("- getFlowState — read the flow's live state");
  });

  it("describes the token as issued-at-run-start for previews without a live attempt", () => {
    const block = agentToolsBlock({
      baseUrl: "https://x",
      flowId: "f",
      nodeKey: "n",
      token: null,
      tools: TOOLS,
    });
    expect(block).toContain("Authorization: Bearer <capability token — issued at run start>");
  });
});

describe("redactCapabilityToken", () => {
  it("masks every occurrence of the token (safety net — live prompts no longer carry it)", () => {
    expect(redactCapabilityToken("a tok-abc123 b tok-abc123", "tok-abc123"))
      .toBe(`a ${TOKEN_MASK} b ${TOKEN_MASK}`);
    expect(redactCapabilityToken("no token here", "tok-abc123")).toBe("no token here");
    expect(redactCapabilityToken("text", null)).toBe("text");
  });
});
