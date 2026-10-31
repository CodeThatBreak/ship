import type { RefObject } from "react";
import type { BuilderApi } from "@/components/templateEditor/BuilderCanvas";
import type { CanvasPosition, Draft } from "@/components/templateEditor/draft";

/** A new node lands at the viewport center when the canvas reports its
 *  screen→flow helper; a template's first node centers in the empty canvas
 *  at a fixed offset instead. */
export const placeNewNodeIntoLayout = (
  key: string,
  draft: Draft,
  builderApi: RefObject<BuilderApi | null>,
  setPositions: (
    next:
      | Record<string, CanvasPosition>
      | ((cur: Record<string, CanvasPosition>) => Record<string, CanvasPosition>),
  ) => void,
): CanvasPosition => {
  let pos: CanvasPosition;
  if (draft.nodes.length === 0) {
    pos = { x: 320, y: 320 };
  } else if (builderApi.current?.screenToFlowPosition && typeof window !== "undefined") {
    const center = builderApi.current.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    pos = { x: Math.round(center.x - 90), y: Math.round(center.y - 40) };
  } else {
    pos = { x: 320, y: 320 };
  }
  setPositions((p) => ({ ...p, [key]: pos }));
  return pos;
};
