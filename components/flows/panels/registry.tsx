"use client";
import type { ComponentType } from "react";
import type { FlowData, Node } from "@/types/flow";
import type { FeedEvent } from "@/lib/groupEvents";

/**
 * The panel contract (pristine plan §3.1): the UI resolves a node's panel from
 * a registry instead of switching on node keys. Panels register themselves at
 * module import (see `components/flows/panels/index.tsx`) keyed by builtin def key
 * (`node.type` — the node's resolved def key) or declarative kind
 * (`node.kind` — agent / decision / http / script); built-ins may also carry a
 * `panelTitle` capability on the engine-side node definition, which
 * `PanelShell` reads for the header.
 */

/** What a panel may pass to an action: the action route's open body shape. */
export type ActionPayload = Record<string, unknown>;

/** Everything a panel needs — the same shape for every registered panel. */
export interface PanelProps {
  flow: FlowData;
  node: Node;
  action: (a: string, b?: ActionPayload) => Promise<void> | void;
  events?: FeedEvent[];
  model: string;
  fetchArtifact: (id: string) => Promise<unknown>;
}

/** Which nodes a panel serves: builtin def keys (node.type) or declarative kinds (node.kind). */
export interface PanelMatcher {
  type?: string | string[];
  kind?: string | string[];
}

interface PanelEntry {
  matcher: PanelMatcher;
  component: ComponentType<PanelProps>;
}

const panels: PanelEntry[] = [];

/** Register a panel for its node shape. Called once per panel module at import. */
export function registerPanel(matcher: PanelMatcher, component: ComponentType<PanelProps>): void {
  panels.push({ matcher, component });
}

const matches = (value: string | null | undefined, pattern: string | string[]): boolean =>
  Array.isArray(pattern) ? value != null && pattern.includes(value) : value === pattern;

/** The panel serving this node, or null (the caller renders the fallback). */
export function resolvePanel(node: Node): ComponentType<PanelProps> | null {
  for (const { matcher, component } of panels) {
    if (matcher.type && matches(node.type, matcher.type)) return component;
    if (matcher.kind && matches(node.kind, matcher.kind)) return component;
  }
  return null;
}
