import { describe, expect, it } from "vitest";
import { NODE_KIND, type NodeKind } from "@/constants/nodeKind";
import {
  advancedConfigFieldKeys,
  isAdvancedConfigField,
} from "@/components/templateEditor/configFieldLogic";

/** The agent's secondary knobs — everything except mode / prompt / model /
 *  base_ref / effects / output / output_schema, which stay flat on the Config
 *  tab (output_schema shows right under output once json output is selected). */
const ADVANCED_KEYS = [
  "retry_budget",
  "agent_tools",
  "secret_refs",
  "mcp_sources",
];
const CORE_KEYS = [
  "mode",
  "prompt",
  "model",
  "base_ref",
  "effects",
  "output",
  "output_schema",
];
const NON_AGENT_KINDS: NodeKind[] = [
  NODE_KIND.DECISION,
  NODE_KIND.HTTP,
  NODE_KIND.SCRIPT,
];

describe("advancedConfigFieldKeys", () => {
  it("is exactly the agent's secondary-knob vocabulary", () => {
    expect([...advancedConfigFieldKeys].sort()).toEqual([...ADVANCED_KEYS].sort());
  });
});

describe("isAdvancedConfigField", () => {
  it("returns true for the agent's advanced keys", () => {
    for (const key of ADVANCED_KEYS) {
      expect(isAdvancedConfigField(NODE_KIND.AGENT, key)).toBe(true);
    }
  });

  it("returns false for the agent's core keys (they stay flat)", () => {
    for (const key of CORE_KEYS) {
      expect(isAdvancedConfigField(NODE_KIND.AGENT, key)).toBe(false);
    }
  });

  it("returns false for every key on non-agent kinds", () => {
    for (const kind of NON_AGENT_KINDS) {
      for (const key of [...ADVANCED_KEYS, ...CORE_KEYS]) {
        expect(isAdvancedConfigField(kind, key)).toBe(false);
      }
    }
  });
});
