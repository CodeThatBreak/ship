import { describe, expect, it } from "vitest";
import {
  contractConfigSignature,
  contractRelevantConfig,
  hashStableJson,
  kindContractRequest,
  nodeContractRequest,
} from "./contract-request";

describe("contract-request (CR-144)", () => {
  it("keeps only contract-relevant config keys", () => {
    expect(
      contractRelevantConfig({
        prompt: "long body",
        script: "console.log(1)",
        output_schema: { type: "object" },
        choices: [{ label: "a" }],
      }),
    ).toEqual({
      output_schema: { type: "object" },
      choices: [{ label: "a" }],
    });
  });

  it("ignores unrelated config edits in the cache signature", () => {
    const a = contractConfigSignature({ prompt: "one", output_schema: { x: 1 } });
    const b = contractConfigSignature({ prompt: "two", output_schema: { x: 1 } });
    expect(a).toBe(b);
  });

  it("changes the signature when contract-relevant fields change", () => {
    const a = contractConfigSignature({ choices: [{ label: "a" }] });
    const b = contractConfigSignature({ choices: [{ label: "b" }] });
    expect(a).not.toBe(b);
  });

  it("builds stable POST bodies without serializing the full config into the cache key", () => {
    const req = nodeContractRequest(
      {
        nodeTemplateId: "nt_agent",
        kind: "agent",
        config: {
          prompt: "x".repeat(20_000),
          output_schema: { type: "object", properties: { ok: { type: "boolean" } } },
        },
      },
    );
    expect(req.cacheKey.length).toBeLessThan(120);
    expect(req.body.def).toBe("nt_agent");
    expect(req.body.config).toEqual({
      output_schema: { type: "object", properties: { ok: { type: "boolean" } } },
    });
    expect(req.cacheKey).toBe(
      nodeContractRequest({
        nodeTemplateId: "nt_agent",
        kind: "agent",
        config: {
          prompt: "different",
          output_schema: { type: "object", properties: { ok: { type: "boolean" } } },
        },
      }).cacheKey,
    );
  });

  it("hashes JSON deterministically", () => {
    expect(hashStableJson({ b: 1, a: 2 })).toBe(hashStableJson({ a: 2, b: 1 }));
  });

  it("keys kind-only template dialog requests", () => {
    const req = kindContractRequest("decision", {
      choices: [{ label: "yes" }],
      description: "ignored",
    });
    expect(req.body).toEqual({
      kind: "decision",
      config: { choices: [{ label: "yes" }] },
    });
    expect(req.cacheKey.startsWith("kind:decision::")).toBe(true);
  });
});
