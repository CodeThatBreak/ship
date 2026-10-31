"use client";
/**
 * The panels' shared surface, decomposed per AGENTS.md §2.2 (one component per
 * file): the shell (header/status/wait/running states), the cost chip, and the
 * artifact views. This module stays the import point for the panels (and every
 * panel feature imports from here — §2.3 barrels).
 */
export { panelTitle, statusVariant, PanelShell } from "./PanelShell";
export { CostChip } from "./CostChip";
export { GenericArtifact, VersionTabs, ArtifactLoader } from "./artifacts";
export type { ArtifactPayload } from "./artifacts";
