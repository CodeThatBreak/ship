import "server-only";

import type { SubflowEngineSurface } from "../types/subflowEngineSurface";
import { SubflowExpander } from "../subflowExpander";
import { SubflowJoin } from "../subflowJoin";

/**
 * SubflowManager — the subflow runtime facade (task 26, design §7, finding
 * B4). State authority for the declarative `subflow` kind: ONE delegated
 * child flow per configured node, monitorable on its own flow screen, whose
 * terminal output publishes as the parent node's aggregate. This class only
 * delegates — the stage gate + expansion (`SubflowExpander`) and the
 * child-terminal rollup (`SubflowJoin`) are the collaborators the module
 * notes below map.
 *
 * Must never: grow subflow special cases into the stage runner or chain — a
 * new concern registers into the layer that owns it (staging, effects). The
 * engine reference arrives via `bind()` from flowEngine's module tail; this
 * module cannot import the flowEngine value directly (import cycle).
 */
export class SubflowManager {
  /** Engine surface the subflow runtime drives (bound once by flowEngine's module tail). */
  private engine: SubflowEngineSurface | null = null;

  private readonly join: SubflowJoin;
  private readonly expander: SubflowExpander;

  constructor() {
    // the join is wired before the expander (the facade's construction
    // order); the expander hands captured attempt tokens to it
    this.join = new SubflowJoin(() => this.e);
    this.expander = new SubflowExpander(() => this.e, this.join);
  }

  /** Called once from flowEngine.ts (module-load tail) — resolves the engine cycle. */
  bind(engine: SubflowEngineSurface): void {
    this.engine = engine;
  }

  private get e(): SubflowEngineSurface {
    if (!this.engine) throw new Error("SubflowManager is not bound to the engine yet");
    return this.engine;
  }

  // ── the stage gate + expansion (SubflowExpander) ───────────────────────────

  /** The subflow runtime's stage-ownership gate (the delegated-child handoff). */
  gate(flowId: string, nodeKey: string): Promise<"own" | "run" | { run: true; afterRun: () => Promise<void> }> {
    return this.expander.gate(flowId, nodeKey);
  }

  // ── child terminal rollup (SubflowJoin) ────────────────────────────────────

  /** The `onChildTerminal` effect body (`subflowEffects.ts`): a terminal subflow child publishes the parent's aggregate. */
  onChildFinished(childFlowId: string): Promise<void> {
    return this.join.onChildFinished(childFlowId);
  }
}
