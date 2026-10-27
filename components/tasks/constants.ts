/** Predefined status buckets (workflow-agnostic, mapped to statusCategory). */
export const STATUS_VALUES: { value: string; label: string }[] = [
  { value: "To Do", label: "To Do" },
  { value: "In Progress", label: "In Progress" },
  { value: "Done", label: "Done" },
];

/** Debounce applied to the table's free-text filter before it refetches. */
export const TEXT_DEBOUNCE_MS = 400;
