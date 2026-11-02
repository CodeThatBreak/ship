import {
  BookOpen,
  Bug,
  CircleDashed,
  CornerDownRight,
  Layers,
  SquareCheckBig,
  type LucideIcon,
} from "lucide-react";

/** Predefined status buckets (workflow-agnostic, mapped to statusCategory). */
export const STATUS_VALUES: { value: string; label: string }[] = [
  { value: "To Do", label: "To Do" },
  { value: "In Progress", label: "In Progress" },
  { value: "Done", label: "Done" },
];

/** Debounce applied to the table's free-text filter before it refetches. */
export const TEXT_DEBOUNCE_MS = 400;

type TypeStyle = { className: string; Icon: LucideIcon };

const ISSUE_TYPE_STYLES: [RegExp, TypeStyle][] = [
  [/sub-task|subtask/, { Icon: CornerDownRight, className: "bg-zinc-500/10 text-zinc-400" }],
  [/bug/, { Icon: Bug, className: "bg-destructive/10 text-destructive" }],
  [/story/, { Icon: BookOpen, className: "bg-violet-500/10 text-violet-400" }],
  [/epic/, { Icon: Layers, className: "bg-fuchsia-500/10 text-fuchsia-400" }],
  [/task/, { Icon: SquareCheckBig, className: "bg-info/10 text-info" }],
];

const DEFAULT_TYPE_STYLE: TypeStyle = {
  Icon: CircleDashed,
  className: "bg-zinc-500/10 text-zinc-400",
};

/** Issue-type icon + chip tint (sub-task / bug / story / epic / task). */
export const issueTypeStyle = (issueType: string): TypeStyle => {
  const t = (issueType ?? "").toLowerCase();
  for (const [pattern, style] of ISSUE_TYPE_STYLES) {
    if (pattern.test(t)) return style;
  }
  return DEFAULT_TYPE_STYLE;
};

const STATUS_CLASS_RULES: [RegExp, string][] = [
  [/done|closed|resolved|complete/, "bg-success/10 text-success"],
  [/progress|review|testing/, "bg-info/10 text-info"],
  [/block|hold/, "bg-destructive/10 text-destructive"],
];

const DEFAULT_STATUS_CLASS = "bg-zinc-500/10 text-zinc-400";

export const statusBadgeClass = (status: string): string => {
  const s = (status ?? "").toLowerCase();
  for (const [pattern, className] of STATUS_CLASS_RULES) {
    if (pattern.test(s)) return className;
  }
  return DEFAULT_STATUS_CLASS;
};

const PRIORITY_CLASS_RULES: [RegExp, string][] = [
  [/highest|high|critical|urgent/, "bg-destructive/10 text-destructive"],
  [/medium|moderate/, "bg-warning/10 text-warning"],
];

const DEFAULT_PRIORITY_CLASS = "bg-zinc-500/10 text-zinc-400";

export const priorityBadgeClass = (priority: string): string => {
  const p = (priority ?? "").toLowerCase();
  for (const [pattern, className] of PRIORITY_CLASS_RULES) {
    if (pattern.test(p)) return className;
  }
  return DEFAULT_PRIORITY_CLASS;
};
