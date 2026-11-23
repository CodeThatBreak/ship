/** Canvas placement geometry for newly added nodes (§2.7 — no magic numbers). */
export const PLACEMENT = {
  /** An empty template's first node lands in the middle of the flow canvas. */
  EMPTY_CANVAS: { x: 320, y: 320 },
  /** Viewport-center placements are nudged so the node sits under the cursor. */
  CENTER_OFFSET: { x: 90, y: 40 },
} as const;
