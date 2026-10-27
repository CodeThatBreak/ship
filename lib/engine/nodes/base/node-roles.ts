import type { NodeRow } from "../../../db/rows";
import type { PromptAssembly } from "../../prompts/prompt-library";
import { appLayerConfig, configString, mergeConfigLayers } from "../../templates/node-config";
import type { FlowCtx } from "./flow-context";
import type { NodeDefinition } from "./node-definition";

// ── capability-gated node roles (§T4) ────────────────────────────────────────
// The root class no longer carries optional `chat` / `converse` /
// `previewPrompt` hooks: a def only has the affordances its config enables,
// and the call sites (the engine's chat router, the prompt-preview service)
// route through these interfaces — keyed off the same `capabilities` metadata
// the server already serializes to the UI.

/** Where a recorded run's prompt came from. */
export type PromptSource = "modal" | "config" | "default";
export const PROMPT_SOURCES: readonly PromptSource[] = ["modal", "config", "default"];

/** The prompt-route querystring parameters a def's preview may consume. */
export interface PromptPreviewParams {
  /** modal-typed feedback/refine text (plan feedback refinement) */
  feedback?: string;
  /** extra developer instructions (review focus, resolve instructions, pipeline guidance) */
  instructions?: string;
  /** branch-scoped sub-plan preview (plan node only) */
  branch?: string;
  /** context-block picker selection (plan sub-plan refine) */
  contextBlocks?: string[];
}

/**
 * A def-resolved prompt preview: the template key whose metadata the modal
 * shows (plan may point at plan_refine), the configured body knob (null = the
 * template default is used), and the three-part assembly whose `final` is the
 * exact string the next run sends.
 */
export interface NodePromptPreview {
  templateKey: string;
  configBody: string | null;
  assembly: PromptAssembly;
}

/** A def that can regenerate its output from a chat message (§T4 ChatRefiner). */
export interface ChatRefiner {
  chat(ctx: FlowCtx, content: string, model?: string): Promise<string>;
}

/** A def that answers conversational follow-ups without changing node state. */
export interface Converser {
  converse(ctx: FlowCtx, content: string): Promise<string>;
}

/** A def that publishes a live prompt preview for the prompt modal. */
export interface PromptPreviewer {
  previewPrompt(ctx: FlowCtx, node: NodeRow | null, params: PromptPreviewParams): NodePromptPreview | null;
}

/** The decline a chat-capable-off node still answers with (the old root default). */
export const CHAT_DECLINED = "This node doesn't accept chat input.";

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
    return typeof candidate.chat === "function" ? (def as unknown as ChatRefiner) : null;
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
  previewConfig(def: NodeDefinition, node: NodeRow | null): Record<string, unknown> {
    return mergeConfigLayers(def.defaultConfig(), appLayerConfig(def.key), node?.config ?? null);
  }

  /** Convenience: the def's `prompt_rules` knob for preview assembly. */
  previewRules(def: NodeDefinition, node: NodeRow | null, key = "prompt_rules"): string {
    return configString(this.previewConfig(def, node), key) ?? "";
  }

  /** Convenience: the def's `prompt_body` knob for preview assembly. */
  previewBody(def: NodeDefinition, node: NodeRow | null, key = "prompt_body"): string | null {
    return configString(this.previewConfig(def, node), key) ?? null;
  }
}

export const nodeRoles = new NodeRoleRouter();
