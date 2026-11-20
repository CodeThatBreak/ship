/**
 * ContractPipeline unit tests (step 04): the input/output contract seam.
 * Pure checks — no database, a stub NodeDefinition per scenario.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { NodeDefinition } from "../nodes/shared/nodeDefinition";
import { ContractPipeline } from "./contractPipeline";
import { InputContractError } from "../errors/inputContractError";
import { OutputContractError } from "../errors/outputContractError";
import { DEFAULT_SPLIT_OUTPUT } from "../nodes/shared/capabilities";
import { NODE_STATUS } from "../constants/nodeStatus";

/** A minimal concrete def: schemas injected per scenario, nothing runs. */
class StubDef extends NodeDefinition<Record<string, unknown>, Record<string, unknown>> {
  readonly key: string;
  readonly label = "Stub";
  readonly promptKeys = [] as const;
  readonly order = 1;
  readonly inputSchema = z.looseObject({}) as z.ZodType<Record<string, unknown>>;
  readonly outputSchema: z.ZodType<Record<string, unknown>>;
  override readonly consumes: z.ZodType<Record<string, unknown>>;

  constructor(
    key: string,
    outputSchema: z.ZodType<Record<string, unknown>>,
    consumes: z.ZodType<Record<string, unknown>> = z.object({}),
  ) {
    super();
    this.key = key;
    this.outputSchema = outputSchema;
    this.consumes = consumes;
  }

  async run(): Promise<never> {
    throw new Error("stub def never runs");
  }

  async recover(): Promise<boolean> {
    return false;
  }
}

const contracts = new ContractPipeline();

describe("validateInput — the def's consumes schema", () => {
  it("passes when the materialized input satisfies the declared needs", () => {
    const def = new StubDef("build", z.object({}), z.object({ plan: z.string() }));
    expect(() => contracts.validateInput(def, { plan: "the plan" })).not.toThrow();
  });

  it("throws InputContractError naming the missing field", () => {
    const def = new StubDef("build", z.object({}), z.object({ plan: z.string() }));
    try {
      contracts.validateInput(def, {});
      expect.unreachable("validateInput should have thrown");
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(InputContractError);
      const err = e as InputContractError;
      expect(err.missingField).toBe("plan");
      expect(err.nodeKey).toBe("build");
      expect(err.message).toContain("plan");
    }
  });

  it("skips the def-level check when the def declares no consumes shape", () => {
    const def = new StubDef("agent", z.object({}));
    expect(() => contracts.validateInput(def, {})).not.toThrow();
  });
});

describe("validateInput — the template node's input_map targets", () => {
  const consumer = new StubDef("write_doc", z.object({}));

  it("a mapped expression that produced nothing fails loud, naming the producing node", () => {
    try {
      contracts.validateInput(consumer, {}, { inputMap: { doc: "nodes.summarize.output.markdown" } });
      expect.unreachable("validateInput should have thrown");
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(InputContractError);
      const err = e as InputContractError;
      expect(err.missingField).toBe("doc");
      expect(err.producerKey).toBe("summarize");
      expect(err.message).toContain("doc");
      expect(err.message).toContain("summarize");
    }
  });

  it("a present target passes", () => {
    expect(() =>
      contracts.validateInput(consumer, { doc: "text" }, { inputMap: { doc: "nodes.summarize.output.markdown" } }),
    ).not.toThrow();
  });

  it("a target whose expression addresses no node has no producer attribution", () => {
    try {
      contracts.validateInput(consumer, {}, { inputMap: { summary: "trigger.payload.issue.title" } });
      expect.unreachable("validateInput should have thrown");
    } catch (e: unknown) {
      const err = e as InputContractError;
      expect(err.missingField).toBe("summary");
      expect(err.producerKey).toBeNull();
    }
  });

  it("blank and non-string mappings are not targets", () => {
    expect(() =>
      contracts.validateInput(consumer, {}, { inputMap: { skip: "", also: 42 } }),
    ).not.toThrow();
  });
});

describe("validateOutput — the stage-end contract", () => {
  const def = new StubDef("build", z.object({ branch: z.string(), latestArtifact: z.string() }));

  it("passes a conforming output", () => {
    expect(() => contracts.validateOutput(def, { branch: "feat/x", latestArtifact: "a1" })).not.toThrow();
  });

  it("throws OutputContractError carrying the violations", () => {
    try {
      contracts.validateOutput(def, { branch: 3 });
      expect.unreachable("validateOutput should have thrown");
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(OutputContractError);
      const err = e as OutputContractError;
      expect(err.issues.length).toBeGreaterThan(0);
      expect(err.message).toContain("build");
    }
  });
});

describe("validateTerminalOutput — status-aware terminal writes", () => {
  const def = new StubDef("build", z.object({ branch: z.string() }));

  it("validates success terminals", () => {
    expect(() => contracts.validateTerminalOutput(def, NODE_STATUS.DONE, {})).toThrow(OutputContractError);
    expect(() => contracts.validateTerminalOutput(def, NODE_STATUS.DONE, { branch: "x" })).not.toThrow();
  });

  it("failed/skipped writes are exempt — the violation itself failed the node", () => {
    expect(() => contracts.validateTerminalOutput(def, NODE_STATUS.FAILED, {})).not.toThrow();
    expect(() => contracts.validateTerminalOutput(def, NODE_STATUS.SKIPPED, {})).not.toThrow();
  });
});

describe("validateAggregateOutput — the fan-out/split seam", () => {
  const def = new StubDef("build", z.object({}));

  it("accepts a conforming split aggregate (extra native fields tolerated)", () => {
    expect(() =>
      contracts.validateAggregateOutput("splitOutcome", def, {
        branch: "x",
        units: [{ key: "u1", title: "U", status: "done" }],
      }),
    ).not.toThrow();
  });

  it("refuses a malformed split aggregate", () => {
    try {
      contracts.validateAggregateOutput("splitOutcome", def, {
        units: [{ key: "u1", title: "U", status: 12345 }],
      });
      expect.unreachable("validateAggregateOutput should have thrown");
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(OutputContractError);
    }
  });

  it("uses the def's narrowed capability contract when declared", () => {
    const narrowed = new StubDef("build", z.object({}));
    narrowed.capabilities.splitOutput = DEFAULT_SPLIT_OUTPUT.extend({
      units: z.array(z.object({ key: z.string(), title: z.string(), status: z.string(), output: z.unknown().optional() })).min(1),
    });
    expect(() => contracts.validateAggregateOutput("splitOutcome", narrowed, { units: [] })).toThrow(OutputContractError);
  });
});
