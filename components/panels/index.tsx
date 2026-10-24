"use client";
/**
 * Panel registration (§3.1): importing this module imports every panel, and
 * each panel self-registers with the registry at module import. Add a new
 * panel by creating its module and listing it here — NodePanel never changes.
 */
import "../PlanView";
import "../ReviewView";
import "../AgentNodePanel";
import "../DeclarativeNodePanel";
import "./start-view";
import "./build-view";
import "./pipeline-view";
import "./resolve-view";

export { resolvePanel, registerPanel, type PanelProps, type PanelMatcher } from "./registry";
