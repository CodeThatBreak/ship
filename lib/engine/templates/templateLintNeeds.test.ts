import { describe, expect, it } from "vitest";
import { lintTemplate } from "./templateLint";
import { FACT_KIND, NEEDABLE_FACTS } from "../facts/types/facts";
import { EFFECT_VERB } from "../runtime/effects/constants/effectVerbs";
import type { CatalogEntry, LintEdge, LintNode } from "./lintTypes";

const node = (key: string, nodeTemplateId: string, config: Record<string, unknown> = {}): LintNode => ({
  key,
  nodeTemplateId,
  inputMap: {},
  config,
});

const catalogEntry = (kind: string, config: Record<string, unknown> = {}): CatalogEntry => ({
  kind,
  config,
  key: kind,
  isBuiltin: false,
});

const NEXT = (from: string, to: string): LintEdge => ({ from, to, condition: null, label: null, kind: "next" });

/** The agent template id the catalog entries are keyed by. */
const AGENT_NT = "nt_agent";
/** The gate (decision) template id the catalog entries are keyed by. */
const GATE_NT = "nt_gate";

describe("template-lint — declarative fact needs (task 14)", () => {
  it("passes when a change_request need is covered by an upstream afterApproval effect", async () => {
    const lint = await lintTemplate(
      [
        node("implement", AGENT_NT, { effects: { afterApproval: [EFFECT_VERB.CREATE_CHANGE_REQUEST] } }),
        node("gate", GATE_NT, { needs: [FACT_KIND.CHANGE_REQUEST] }),
      ],
      [NEXT("implement", "gate")],
      { [AGENT_NT]: catalogEntry("agent"), [GATE_NT]: catalogEntry("decision") },
    );
    expect(lint.error).toBeNull();
    expect(lint.problems).toHaveLength(0);
  });

  it("fails naming the unsatisfiable change_request need when no upstream establishes one", async () => {
    const lint = await lintTemplate(
      [
        node("implement", AGENT_NT, { produces: [FACT_KIND.BRANCH] }),
        node("gate", GATE_NT, { needs: [FACT_KIND.CHANGE_REQUEST] }),
      ],
      [NEXT("implement", "gate")],
      { [AGENT_NT]: catalogEntry("agent"), [GATE_NT]: catalogEntry("decision") },
    );
    expect(lint.error).toMatch(/need "change_request" is not satisfiable/);
    expect(lint.error).toMatch(/afterApproval \[create_change_request\]/);
  });

  it("passes when a branch need is covered by an upstream produces declaration", async () => {
    const lint = await lintTemplate(
      [
        node("implement", AGENT_NT, { produces: [FACT_KIND.BRANCH] }),
        node("gate", GATE_NT, { needs: [FACT_KIND.BRANCH] }),
      ],
      [NEXT("implement", "gate")],
      { [AGENT_NT]: catalogEntry("agent"), [GATE_NT]: catalogEntry("decision") },
    );
    expect(lint.error).toBeNull();
    expect(lint.problems).toHaveLength(0);
  });

  it("fails for a need with no upstream node at all", async () => {
    const lint = await lintTemplate(
      [node("gate", GATE_NT, { needs: NEEDABLE_FACTS })],
      [],
      { [GATE_NT]: catalogEntry("decision") },
    );
    expect(lint.error).toMatch(/need "change_request" is not satisfiable/);
    expect(lint.error).toMatch(/need "branch" is not satisfiable/);
  });

  it("walks past an intermediate node to a transitive upstream establisher", async () => {
    const lint = await lintTemplate(
      [
        node("implement", AGENT_NT, { effects: { afterApproval: [EFFECT_VERB.CREATE_CHANGE_REQUEST] } }),
        node("middle", AGENT_NT),
        node("gate", GATE_NT, { needs: [FACT_KIND.CHANGE_REQUEST] }),
      ],
      [NEXT("implement", "middle"), NEXT("middle", "gate")],
      { [AGENT_NT]: catalogEntry("agent"), [GATE_NT]: catalogEntry("decision") },
    );
    expect(lint.error).toBeNull();
  });

  it("reports an unknown need value as a vocabulary error", async () => {
    const lint = await lintTemplate(
      [node("gate", GATE_NT, { needs: ["diff"] })],
      [],
      { [GATE_NT]: catalogEntry("decision") },
    );
    expect(lint.error).toMatch(/unknown need "diff" — use one of: change_request, branch/);
  });
});
