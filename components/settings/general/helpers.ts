/**
 * Model ids are stored normalized (no "[fast=false]"-style params) — strip any
 * legacy bracket params defensively so they can never surface in the UI.
 */
export function baseModelId(raw: string | undefined | null): string {
  return (raw ?? "").trim().replace(/\[[^\]]*\]$/, "").trim();
}
