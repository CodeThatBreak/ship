import { describe, expect, it } from "vitest";

import {
  editorSaveErrorFromResponse,
  shouldAdoptServerDraftAfterSave,
} from "@/components/builder/utils/editor-save-response";
import { shouldApplyValidationSeq } from "@/components/template-editor/utils/validation-seq";

import { mergePositionsIntoDetail } from "@/components/template-editor/hooks/use-node-positions";
import type { TemplateEditorDetail } from "@/types/template-editor";

describe("mergePositionsIntoDetail", () => {
  it("writes dragged coordinates into the detail cache row (CR-140)", () => {
    const detail = {
      template: {
        id: "t1",
        name: "Flow",
        description: null,
        version: 1,
        is_builtin: false,
        trigger: { type: "manual" },
      },
      hook: null,
      nodes: [
        {
          key: "a",
          node_template_id: "nt1",
          label: null,
          trigger: null,
          join_mode: null,
          config: {},
          input_map: {},
          kind: null,
          icon: null,
          catalog_name: null,
          catalog_key: null,
          is_builtin: false,
          is_local: false,
          x: 0,
          y: 0,
        },
      ],
      edges: [],
    } satisfies TemplateEditorDetail;

    const merged = mergePositionsIntoDetail(detail, { a: { x: 12, y: 34 } });
    expect(merged.nodes[0]?.x).toBe(12);
    expect(merged.nodes[0]?.y).toBe(34);
  });
});

describe("editorSaveErrorFromResponse", () => {
  it("treats non-OK HTTP as failure even without a JSON body (CR-030)", () => {
    expect(editorSaveErrorFromResponse(false, 500, null)).toMatch(/500/);
    expect(editorSaveErrorFromResponse(false, 413, null)).toMatch(/413/);
  });

  it("returns null only for OK responses without an error field", () => {
    expect(editorSaveErrorFromResponse(true, 200, null)).toBeNull();
    expect(editorSaveErrorFromResponse(true, 200, { error: "nope" })).toBe("nope");
  });
});

describe("shouldAdoptServerDraftAfterSave", () => {
  it("adopts server draft only when edit generation is unchanged (CR-029)", () => {
    expect(shouldAdoptServerDraftAfterSave(3, 3)).toBe(true);
    expect(shouldAdoptServerDraftAfterSave(3, 4)).toBe(false);
  });
});

describe("shouldApplyValidationSeq", () => {
  it("applies validation only for the latest in-flight sequence (CR-136)", () => {
    expect(shouldApplyValidationSeq(2, 2)).toBe(true);
    expect(shouldApplyValidationSeq(1, 2)).toBe(false);
  });
});
