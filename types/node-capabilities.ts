/**
 * Client-safe node capability types.
 *
 * Type-only re-exports from `@/lib/engine/nodes/base/capabilities` (erased by
 * the bundler, see the Phase 0 baseline). Client components import from here
 * instead of reaching into lib/engine.
 *
 * `NodeUiCapabilities` is what actually crosses the server→client boundary —
 * the flow snapshot projects each node's def capabilities onto it (the
 * engine-only `mergeBack` callback and `fanoutOutput` Zod contract can't be
 * serialized). `NodeCapabilities` is the full engine-side shape, re-exported
 * for consumers that hold a def directly.
 */
export type {
  NodeCapabilities,
  NodeUiCapabilities,
} from "@/lib/engine/nodes/base/capabilities";
