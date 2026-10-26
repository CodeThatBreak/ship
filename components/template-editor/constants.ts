/** Option catalogs and copy for the template editor. */

import type { StartFieldType } from "@/types/start-contract";

/** Node trigger types — rendered as heading + gray description in the picker. */
export const TRIGGER_TYPES: Record<string, { label: string; description: string }> = {
  auto: { label: "Auto", description: "Runs when joins are satisfied" },
  manual: { label: "Manual", description: "Runs when you click run" },
  approval: { label: "Approval", description: "Runs when eligible, holds for your approve" },
  debounced: { label: "Debounced", description: "Runs after a quiet period following events" },
};

export interface WaitForSource {
  value: string;
  label: string;
  description: string;
  /** the variable this event publishes into the run context — enforced:
   *  present and required while the source is selected, never authorable */
  contextField?: { key: string; type: StartFieldType };
}

/** Wait-for sources, grouped for the picker (flat list kept for lookups). */
export const WAIT_FOR_GROUPS: { label: string; sources: WaitForSource[] }[] = [
  {
    label: "Pipeline & comments",
    sources: [
      {
        value: "pipeline",
        label: "CI pipeline",
        description: "Waits for CI pipeline events",
        contextField: { key: "pipeline", type: "string" },
      },
      {
        value: "comments",
        label: "Change-request comments",
        description: "Waits for review comment events",
        contextField: { key: "mr", type: "string" },
      },
    ],
  },
  {
    label: "Resumes",
    sources: [
      { value: "webhook", label: "Webhook", description: "An inbound hook delivery resumes the node" },
      { value: "timer", label: "Timer", description: "Resumes after a delay (minutes below)" },
    ],
  },
];

export const WAIT_FOR_SOURCES: WaitForSource[] = WAIT_FOR_GROUPS.flatMap((g) => g.sources);

/** Flow-trigger runtime labels — every template's flows can always be started
 *  manually (task picker) or by a webhook delivery; the declared trigger only
 *  carries the optional schedule (unknown/absent types read as manual). */
export const FLOW_TRIGGER_TYPE: Record<string, string> = {
  manual: "manual / webhook",
  schedule: "schedule",
};
