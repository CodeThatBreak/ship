// ── General settings feature constants (AGENTS.md §1.6) ─────────────────────

import { Cloud, Cpu, FolderGit2, type LucideIcon } from "lucide-react";

import { RUN_MODE } from "@/constants/execution";

/** Per-mode icon. The cascade itself is data-driven from `settings.harnesses`
 *  — this only maps a mode value onto presentation. */
export const EXECUTION_MODE_META: Record<string, { icon: LucideIcon }> = {
  [RUN_MODE.CLOUD]: { icon: Cloud },
  [RUN_MODE.LOCAL]: { icon: FolderGit2 },
};

/** Icon for mode values without dedicated artwork (data-driven cascade). */
export const MODE_FALLBACK_ICON: LucideIcon = Cpu;

/** Where unconfigured harnesses/modes are set up — reused by the hints. */
export const INTEGRATIONS_HARNESS_HINT = "Settings → Integrations → Harness";

/** Fallback note shown when the model catalog is unreachable. */
export const MODEL_FALLBACK_NOTE = "model catalog unavailable — showing built-in list";

/** The usage string reused by the secrets help text and modal description. */
export const SECRETS_USAGE = "{{secrets.NAME}}";

/** Mask shown instead of a secret value (values are write-only). */
export const SECRET_MASK = "••••";

/** Placeholders for the add/edit secret form. */
export const SECRET_PLACEHOLDER = {
  NAME: "NAME (e.g. SLACK_WEBHOOK)",
} as const;

/** Modal titles for the add / edit secret forms. */
export const SECRET_MODAL_TITLE = {
  ADD: "Add secret",
  EDIT: "Edit secret",
} as const;

/** HTTP allowlist textarea placeholder (one hostname per line). */
export const ALLOWLIST_PLACEHOLDER = "hooks.slack.com\napi.github.com";
