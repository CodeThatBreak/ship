import type { PromptBlock, PromptTemplate } from "./prompt-defaults";
import { DEFAULT_PROMPT_TEMPLATES } from "./prompt-defaults";
import { nodeRegistry } from "../nodes/registry";

export type { PromptBlock, PromptTemplate } from "./prompt-defaults";

export type PromptCtx = Record<string, string | undefined>;

/** One rendered internal block — the modal shows these with char counts. */
export interface RenderedBlock {
  kind: PromptBlock["kind"];
  text: string;
}

/**
 * The three-part assembly of one node prompt:
 *   body (user's) → userRules (user's, from the `prompt_rules` config knob)
 *   → internal blocks (engine rules + locked output contract + run data).
 * `final` is exactly what the agent receives; the prompt modal previews it.
 */
export interface PromptAssembly {
  body: string;
  userRules: string;
  blocks: RenderedBlock[];
  final: string;
}

/** The prompt modal's display shape: the user's part vs the engine's locked parts. */
export interface PromptSections {
  /** the editable body — modal textarea seed */
  body: string;
  /** the user's standing rules (the `prompt_rules` config knob) */
  userRules: string;
  /** engine-authored rules, rendered — shown locked in the modal */
  engineRules: string;
  /** the machine-parsed output contract, rendered — shown locked in the modal */
  outputContract: string;
  /** live run-data blocks (context, diffs, logs, comments) — finalized at run time */
  runData: RenderedBlock[];
  /** exactly what the agent receives */
  final: string;
}

/** Split an assembly into the modal's display sections. */
export function sectionsOf(asm: PromptAssembly): PromptSections {
  const text = (kind: PromptBlock["kind"]) =>
    asm.blocks.filter((b) => b.kind === kind).map((b) => b.text).filter(Boolean).join("\n\n");
  return {
    body: asm.body,
    userRules: asm.userRules,
    engineRules: text("rules"),
    outputContract: text("contract"),
    runData: asm.blocks.filter((b) => b.kind === "data"),
    final: asm.final,
  };
}

/**
 * The library of prompt templates: the three-part defaults
 * (`prompt-defaults.ts`) plus `{{var}}` rendering and one assembly path used
 * by both the run-time nodes and the prompt modal's preview. Custom prompt
 * bodies are a per-node config knob (`prompt_body`) — the global
 * `prompt_templates` settings overlay was removed.
 */
export class PromptLibrary {
  /**
   * Top-level template keys shown on the settings page — the registered
   * defs' user-editable prompt sections (sub-keys like `plan_refine`
   * excluded). Derived from the registry at call time: the defs own their
   * prompt sections, the library owns no node-key list.
   */
  static topLevelKeys(): string[] {
    const out: string[] = [];
    for (const d of nodeRegistry.all()) out.push(...d.promptSections);
    return out;
  }

  /** Return the template for a node key — the hardcoded default only. */
  getTemplate(nodeKey: string): PromptTemplate {
    return DEFAULT_PROMPT_TEMPLATES[nodeKey];
  }

  /**
   * Normalization applied to every rendered block: trim + collapse multi-blank
   * runs (run data like diffs/comments can produce them). Applied on BOTH the
   * preview and the run path, so the modal's `final` and run() stay
   * byte-identical by construction — per-node `.split("\n").filter(Boolean)`
   * collapses are what I7 was found by and are gone (see node defs).
   */
  private static normalizeBlock(text: string): string {
    return text.trim().replace(/\n{3,}/g, "\n\n");
  }

  /**
   * Render a template string with the given context.
   * `{{var}}` placeholders are replaced by `ctx[var] ?? ""`.
   */
  private render(template: string, ctx: PromptCtx): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, name) => ctx[name] ?? "");
  }

  /**
   * The user-editable body of a template: what the prompt modal shows and lets
   * the user edit. Internal instructions (see `internalSuffix`) are stripped —
   * they are re-appended automatically at run time, so users can't break the
   * output contracts the code parses.
   */
  renderUserTemplate(nodeKey: string, ctx: PromptCtx, extra?: PromptCtx): string {
    const tpl = this.getTemplate(nodeKey);
    return this.render(tpl.userTemplate, { ...ctx, ...extra }).trim();
  }

  /**
   * The engine-authored internal blocks for a node key, rendered. Order and
   * content are the template's own (rules / output contract / run data) —
   * never user-mutable, so custom bodies can't lose the contracts the code
   * parses. Returns [] for body-only templates.
   */
  internalBlocks(nodeKey: string, ctx: PromptCtx, extra?: PromptCtx): RenderedBlock[] {
    const def = DEFAULT_PROMPT_TEMPLATES[nodeKey];
    if (!def) return [];
    const vars = { ...ctx, ...extra };
    return def.internalBlocks.map((b) => ({
      kind: b.kind,
      text: PromptLibrary.normalizeBlock(this.render(b.text, vars)),
    }));
  }

  /**
   * Assemble the full prompt for a node run — the single source of truth for
   * what the model receives. `body` overrides the template's user body (the
   * modal's edited text or the `prompt_body` config knob); `userRules` (the
   * `prompt_rules` config knob) is appended right after the body, before the
   * engine's locked blocks.
   */
  assemblePrompt(
    nodeKey: string,
    ctx: PromptCtx,
    extra?: PromptCtx,
    opts?: { body?: string | null; userRules?: string | null },
  ): PromptAssembly {
    const tpl = this.getTemplate(nodeKey);
    const vars = { ...ctx, ...extra };
    // I7: the body gets the same normalization as the internal blocks — an
    // empty rendered var ({{context}}, …) would otherwise leave multi-blank
    // runs in the recorded run prompt. Applied to BOTH paths (user body knob
    // and default render) so the modal's final and run() match by construction.
    const body = PromptLibrary.normalizeBlock(opts?.body != null && opts.body.trim() ? opts.body : this.render(tpl.userTemplate, vars));
    const userRules = (opts?.userRules ?? "").trim();
    const blocks = this.internalBlocks(nodeKey, ctx, extra).filter((b) => b.text);
    return {
      body,
      userRules,
      blocks,
      final: [body, userRules, ...blocks.map((b) => b.text)].filter(Boolean).join("\n\n"),
    };
  }

  /**
   * The internal-instruction block that must follow the user-editable body at
   * run time: the template's rendered internal blocks. Kept for the few call
   * sites not yet on `assemblePrompt` — unlike the old prefix-strip approach
   * it never re-includes the body (the pre-refactor review/resolve/
   * pipeline_fix assembly duplicated the body placeholder mid-template).
   */
  internalSuffix(nodeKey: string, ctx: PromptCtx, extra?: PromptCtx): string {
    return this.internalBlocks(nodeKey, ctx, extra)
      .map((b) => b.text)
      .filter(Boolean)
      .join("\n\n");
  }

  /**
   * Resolve the prompt for a node run.
   *
   * @param nodeKey  e.g. "plan", "build", "pipeline_fix", "review", "resolve"
   * @param ctx      base context variables (ticket, branch, mode, …)
   * @param extra    per-run extras (feedback, instructions, plan, diff, logs, comments, …)
   * @param override verbatim prompt that bypasses the template entirely
   * @param opts     `userRules` (the `prompt_rules` config knob) is appended
   *                 after the body/override, before the engine's locked blocks
   */
  resolve(
    nodeKey: string,
    ctx: PromptCtx,
    extra?: PromptCtx,
    override?: string | null,
    opts?: { userRules?: string | null },
  ): string {
    const userRules = (opts?.userRules ?? "").trim();
    if (override) {
      return userRules ? `${override.trim()}\n\n${userRules}` : override.trim();
    }
    return this.assemblePrompt(nodeKey, ctx, extra, { userRules }).final;
  }

  /** Validate that a node key is known. */
  isValidNodeKey(key: string): boolean {
    return key in DEFAULT_PROMPT_TEMPLATES;
  }

  /**
   * A template's three parts for the editors (the template node config's
   * Prompt tab, the prompt modal): the body, the engine's locked rules and
   * the locked output contract — UNRENDERED, `{{vars}}` intact, so editors
   * show placeholders rather than one run's values.
   */
  templateParts(nodeKey: string): {
    label: string;
    description: string;
    variables: string[];
    body: string;
    engineRules: string;
    outputContract: string;
  } | null {
    const tpl = DEFAULT_PROMPT_TEMPLATES[nodeKey];
    if (!tpl) return null;
    const text = (kind: PromptBlock["kind"]) =>
      tpl.internalBlocks.filter((b) => b.kind === kind).map((b) => b.text).join("\n\n");
    return {
      label: tpl.label,
      description: tpl.description,
      variables: tpl.variables,
      body: tpl.userTemplate,
      engineRules: text("rules"),
      outputContract: text("contract"),
    };
  }
}

export const prompts = new PromptLibrary();
