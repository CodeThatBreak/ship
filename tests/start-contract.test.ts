import { describe, expect, it } from "vitest";
import { parseStartContract } from "@/types/start-contract";

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
