import { describe, expect, it } from "vitest";
import {
  parseStartContract,
  validateAgainstContract,
  type StartContractField,
} from "@/types/start-contract";

describe("parseStartContract", () => {
  it("returns an empty list when config is missing or invalid", () => {
    expect(parseStartContract(undefined)).toEqual([]);
    expect(parseStartContract(null)).toEqual([]);
    expect(parseStartContract("nope")).toEqual([]);
  });

  it("parses declared fields from start node config", () => {
    expect(
      parseStartContract({
        contract: [{ key: "repo_id", type: "string", required: true }],
      }),
    ).toEqual([{ key: "repo_id", type: "string", required: true, label: undefined, default: undefined }]);
  });
});

describe("validateAgainstContract", () => {
  const fields: StartContractField[] = [
    { key: "count", type: "number", required: true },
    { key: "enabled", type: "boolean", required: false },
    { key: "meta", type: "object", required: false },
  ];

  it("coerces string form values into typed contract fields", () => {
    const result = validateAgainstContract(fields, {
      count: "42",
      enabled: "true",
      meta: '{"ok":1}',
    });
    expect(result).toEqual({
      ok: true,
      values: { count: 42, enabled: true, meta: { ok: 1 } },
    });
  });

  it("rejects unknown payload keys", () => {
    const result = validateAgainstContract(fields, { count: "1", extra: "nope" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/outside the contract/);
  });
});
