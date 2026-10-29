"use client";
import type { ComponentType } from "react";
import type { Node } from "@/types/flow";
import { PlanNodeChat, PlanView } from "../components/plan";
import AgentView from "./AgentView";
import BuildView from "./BuildView";
import DeclarativeView from "./DeclarativeView";
import NodeChat from "./NodeChat";
import PipelineView from "./PipelineView";
import ResolveView from "./ResolveView";
import ReviewView from "./ReviewView";
import StartView from "./StartView";

/**
 * The node workspace factory (§3.1's registry, resolved explicitly): a
 * node's panel is looked up from its builtin def key (`node.type`) or its
 * declarative kind (`node.kind`), and its chat rail from the node contract's
 * capabilities — `refinable` marks the agent-backed nodes that can converse,
 * and `chatMode: "plan"` swaps in the plan feature's composer-driven rail
 * (docs/plan-conversation-refine.md). No node-key switches, no import
 * side-effects — adding a panel is one entry in a table below.
 */

/** The workspace a node's column resolves into: a panel plus, when the node
 *  contract says so, its chat rail. */
export interface NodeWorkspace {
  panel: ComponentType | null;
  chat: ComponentType | null;
}

/** Panels keyed by builtin def key (node.type). */
const PANEL_BY_TYPE: Record<string, ComponentType> = {
  plan: PlanView,
  review: ReviewView,
  build: BuildView,
  // the step_build child def shares this panel on its own child flow screen
  step_build: BuildView,
  pipeline: PipelineView,
  resolve: ResolveView,
  start: StartView,
};

/** Panels keyed by declarative kind (node.kind) — checked after the def key. */
const PANEL_BY_KIND: Record<string, ComponentType> = {
  agent: AgentView,
  decision: DeclarativeView,
  http: DeclarativeView,
  script: DeclarativeView,
};

/** The chat rail for the node's chat-capability grade (or null: nothing to converse with). */
const resolveChat = (node: Node): ComponentType | null => {
  const capabilities = node.capabilities;
  if (!capabilities?.refinable) return null;
  return capabilities.chatMode === "plan" ? PlanNodeChat : NodeChat;
};

/** The workspace serving this node — `panel: null` means the caller renders the fallback. */
export function resolveNodePanel(node: Node): NodeWorkspace {
  const panel = PANEL_BY_TYPE[node.type] ?? (node.kind ? (PANEL_BY_KIND[node.kind] ?? null) : null);
  return { panel, chat: panel ? resolveChat(node) : null };
}
