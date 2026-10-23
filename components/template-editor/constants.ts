/** Option catalogs and copy for the template editor. */
export const TRIGGER_TYPES: Record<string, string> = {
  auto: "auto — runs when joins are satisfied",
  manual: "manual — user clicks run",
  approval: "approval — runs when eligible, holds for approve",
  debounced: "debounced — quiet period after events",
};

export const WAIT_FOR_SOURCES: { value: string; label: string }[] = [
  { value: "gitlab_pipeline", label: "gitlab_pipeline — CI pipeline events" },
  { value: "gitlab_comments", label: "gitlab_comments — MR comment events" },
];

export const FLOW_TRIGGER_TYPE: Record<string, string> = {
  manual: "manual — ticket picker",
  webhook: "webhook — inbound hook (Phase 4)",
  schedule: "schedule — interval (Phase 4)",
};

export const GENERIC_TRIGGER_HELP =
  "Triggers decide how a node runs when the template says it's its turn. `approval` nodes run to await your approve action before edges activate; `debounced` nodes wait for a quiet period.";
