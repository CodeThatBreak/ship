"use client";
import { useEffect, useRef } from "react";

/**
 * The plan panel ↔ chat composer channel (docs/plan-conversation-refine.md
 * §4d): PlanView/PlanPanelHeader/SubPlanCard live in the LEFT subtree and
 * usePlanComposer (the composer config builder) in the RIGHT chat rail — a
 * tiny typed pub-sub replaces threading a `focusChat` prop through the
 * panel surface (the panels read the NodePanelContext; the composer config
 * stays plan-feature-local in PlanNodeChat).
 *
 * Bound consumers: the producers in PlanView (header button → focus,
 * branch card → prefill) and usePlanComposer (the only subscriber).
 */
export type PlanComposerCommand =
  | { kind: "focusComposer"; at: number }
  | { kind: "prefillBranch"; branch: string; at: number };

type Listener = (command: PlanComposerCommand) => void;

/** The plan panel → composer commands. One shared emitter per module. */
export class PlanComposerBus {
  private listeners = new Set<Listener>();
  private tick = 0;

  /** Subscribe; returns the unsubscribe. Listeners stay fresh via a ref. */
  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(command: PlanComposerCommand): void {
    for (const listener of [...this.listeners]) listener(command);
  }

  /** Focus the conversation composer (the plan panel header's action). */
  focusComposer(): void {
    this.emit({ kind: "focusComposer", at: ++this.tick });
  }

  /** Enter the scoped-refine prefill state for one branch (§4c). */
  prefillBranch(branch: string): void {
    this.emit({ kind: "prefillBranch", branch, at: ++this.tick });
  }
}

export const planComposerBus = new PlanComposerBus();

/** Subscribe a handler that stays fresh across renders (registered once). */
export function usePlanComposerCommand(handler: Listener): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    const listener: Listener = (command) => handlerRef.current(command);
    return planComposerBus.on(listener);
  }, []);
}
