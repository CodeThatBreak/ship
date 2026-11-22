import { PANEL_VERB_STATUSES } from "@/constants/flow";

/** Whether the node's status sits in the engine's `panelVerb` fence — a
 *  terminal state the verb may fire from (a live run still owns its branch). */
export const isPanelVerbEligible = (status: string): boolean =>
  (PANEL_VERB_STATUSES as readonly string[]).includes(status);
