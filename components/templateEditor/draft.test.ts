import { describe, expect, it } from "vitest";
import { uniqueKey } from "./draft";
import type { EditorNode } from "./types";

const node = (key: string): EditorNode => ({
  key,
  nodeTemplateId: "nt_x",
  label: key,
  overrideLabel: null,
  trigger: { type: "auto" },
  join_mode: "all",
  config: {},
  input_map: {},
  kind: "agent",
  icon: "bot",
  catalog_name: key,
  catalogKey: null,
  is_builtin: false,
});

describe("uniqueKey", () => {
  it("prefixes slugs that do not start with a letter (CR-032)", () => {
    expect(uniqueKey("2plan", [])).toBe("n_2plan");
    expect(uniqueKey("_foo", [])).toBe("n_foo");
  });

  it("avoids collisions after normalization", () => {
    const nodes = [node("n_plan")];
    expect(uniqueKey("plan", nodes)).toBe("n_plan_2");
  });
});
