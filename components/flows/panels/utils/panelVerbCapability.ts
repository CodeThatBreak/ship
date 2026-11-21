import { DECLARED_EFFECTS, PANEL_VERB_STATUSES } from "@/constants/flow";

/**
 * Whether a node's effective config declares an effect verb under the
 * `afterApproval` lifecycle — the panel's capability rule (task 12, design
 * §4.2): the effects declaration IS the capability (the design doc declares
 * no separate capability vocabulary), so a declarative node whose config
 * lists the verb may fire it from the panel without an approval hold.
 */
export const declaresEffectVerb = (
  config: Record<string, unknown> | null | undefined,
  verb: string,
): boolean => {
  if (!config) return false;
  const effects = config[DECLARED_EFFECTS.CONFIG_KEY];
  if (!effects || typeof effects !== "object" || Array.isArray(effects)) return false;
  const declared = (effects as Record<string, unknown>)[DECLARED_EFFECTS.AFTER_APPROVAL];
  return Array.isArray(declared) && declared.includes(verb);
};

/** Whether the node's status sits in the engine's `panelVerb` fence — a
 *  terminal state the verb may fire from (a live run still owns its branch). */
export const isPanelVerbEligible = (status: string): boolean =>
  (PANEL_VERB_STATUSES as readonly string[]).includes(status);
