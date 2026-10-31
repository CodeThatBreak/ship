/**
 * Client-safe model-spec types.
 *
 * Pure type re-exports from `@/lib/modelSpec` (the only importable lib module
 * alongside `lib/utils`). Future client code imports types from `@/types/…`
 * instead of reaching into `lib/`; components still import from both today —
 * redistributing them happens in a later phase.
 */
export type { CatalogModel, ModelChoice } from "@/lib/modelSpec";
