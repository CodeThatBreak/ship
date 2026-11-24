"use client";
/**
 * The panels' shared surface, decomposed per AGENTS.md §2.2 (one component per
 * file): the shell (header/status/wait/running states), the cost chip, and the
 * artifact views. This module stays the import point for the panels (and every
 * panel feature imports from here — §2.3 barrels).
 */
export { PanelShell } from "./components/shell/PanelShell";
export { panelTitle } from "./utils/panelTitle";
export { CostChip } from "./components/shell/CostChip";
export { GenericArtifact, VersionTabs, ArtifactLoader } from "./artifacts/artifactExports";
export type { ArtifactPayload } from "./artifacts/artifactExports";
