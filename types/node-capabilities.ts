/**
 * Client-safe node UI capabilities type.
 *
 * Type-only re-export from `@/lib/engine/nodes/base/capabilities` (erased by
 * the bundler, see the Phase 0 baseline). Client components import from here
 * instead of reaching into lib/engine.
 */
export type { NodeCapabilities } from "@/lib/engine/nodes/base/capabilities";
