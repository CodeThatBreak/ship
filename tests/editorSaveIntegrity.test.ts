import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import {
  editorSaveErrorFromResponse,
  shouldAdoptServerDraftAfterSave,
} from "@/components/builder/editor/utils/editorSaveResponse";
import { shouldApplyValidationSeq } from "@/components/templateEditor/utils/validationSeq";

import {
  mergePositionsIntoDetail,
  mergePositionsIntoDetailCache,
} from "@/components/templateEditor/hooks/useNodePositions";
import { queryKeys } from "@/constants/queryKeys";
import type { TemplateEditorDetail } from "@/types/templateEditor";

const detail = {
  template: {
    id: "t1",
    name: "Flow",
    description: null,
    version: 1,
    isBuiltin: false,
    trigger: { type: "manual" },
  },
  hook: null,
  nodes: [
    {
      key: "a",
      nodeTemplateId: "nt1",
      label: null,
      trigger: null,
      joinMode: null,
      config: {},
      inputMap: {},
      kind: null,
      icon: null,
      catalogName: null,
      catalogKey: null,
      isBuiltin: false,
      isLocal: false,
      x: 0,
      y: 0,
    },
  ],
  edges: [],
} satisfies TemplateEditorDetail;

describe("mergePositionsIntoDetail", () => {
  it("writes dragged coordinates into the detail cache row (CR-140)", () => {
    const merged = mergePositionsIntoDetail(detail, { a: { x: 12, y: 34 } });
    expect(merged.nodes[0]?.x).toBe(12);
    expect(merged.nodes[0]?.y).toBe(34);
  });
});

describe("mergePositionsIntoDetailCache", () => {
  it("does not advance dataUpdatedAt, so autosave cannot trigger draft adoption that drops local nodes", () => {
    const queryClient = new QueryClient();
    const key = queryKeys.templates.detail("t1");
    queryClient.setQueryData(key, detail, { updatedAt: 1000 });

    mergePositionsIntoDetailCache(queryClient, "t1", { a: { x: 12, y: 34 } });

    const state = queryClient.getQueryState<TemplateEditorDetail>(key);
    expect(state?.dataUpdatedAt).toBe(1000);
    expect(state?.data?.nodes[0]?.x).toBe(12);
    expect(state?.data?.nodes[0]?.y).toBe(34);
    expect(state?.data?.nodes).toHaveLength(1);
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
