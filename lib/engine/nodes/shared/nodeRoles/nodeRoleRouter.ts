import "server-only";

import { appLayerConfig, configString, mergeConfigLayers } from "../../../templates/nodeConfig";
import type { NodeRow } from "../../../../db/rows";
import type { NodeDefinition } from "../nodeDefinition";
import type { ChatRefiner, Converser, PromptPreviewer } from "./types/nodeRoles";

/**
 * The role router (§T4): the ONE place dispatching a def's chat / converse /
 * prompt-preview affordances, keyed off the `capabilities` metadata the
 * server already serializes to the UI, plus the preview-config helpers the
 * former base-class methods backed. Stateless over injected defs — one
 * engine-wide instance (`nodeRoles`), pass a def per call.
 */
export class NodeRoleRouter {
  /** The "nothing to talk to" reply for defs without an agent run behind them. */
  noAgentReply(label: string): string {
    return `There's no ${label} agent to chat with yet — run the step first (or switch on refine mode), then ask me anything.`;
  }

  /**
   * The chat router for refine messages: a def refines only when its
   * capabilities opt in (`refinable`) AND it implements the role — a decision
   * kind (whose pick is confirmed on the card, never from chat) declines here
   * exactly like the old root default did.
   */
  chatRefinerOf(def: NodeDefinition): ChatRefiner | null {
    if (def.capabilities.refinable !== true) return null;
    const candidate = def as Partial<ChatRefiner>;
    return typeof candidate.chat === "function" && typeof candidate.turn === "function"
      ? (def as unknown as ChatRefiner)
      : null;
  }

  /** The conversational ("just chat", `chatOnly`) role — the agent-run tier provides it. */
  converserOf(def: NodeDefinition): Converser | null {
    return typeof (def as Partial<Converser>).converse === "function" ? (def as unknown as Converser) : null;
  }

  /** The prompt-modal preview role — structural: only defs that publish a preview. */
  promptPreviewerOf(def: NodeDefinition): PromptPreviewer | null {
    return typeof (def as Partial<PromptPreviewer>).previewPrompt === "function"
      ? (def as unknown as PromptPreviewer) : null;
  }

  /**
   * The effective config for prompt preview (class defaults ← app settings ←
   * the flow creation snapshot) — the same layering nodeConfig() merges for
   * chat follow-ups, taking the row explicitly so a node that never ran still
   * previews.
   */
  async previewConfig(def: NodeDefinition, node: NodeRow | null): Promise<Record<string, unknown>> {
    return mergeConfigLayers(def.defaultConfig(), await appLayerConfig(def.key), node?.config ?? null);
  }

  /** Convenience: the def's `prompt_body` knob for preview assembly. */
  async previewBody(def: NodeDefinition, node: NodeRow | null, key = "prompt_body"): Promise<string | null> {
    return configString(await this.previewConfig(def, node), key) ?? null;
  }
}
