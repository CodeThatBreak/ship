// ── Repositories settings feature constants (AGENTS.md §1.6) ────────────────

/** Branch used when a repo doesn't specify one — matches the API default. */
export const REPO_DEFAULT_BRANCH = "main";

/** Card badge copy for the local-checkout state. */
export const REPO_BADGE = {
  LOCAL_READY: "local-ready",
  LOCAL_MISSING: "path missing",
} as const;

/** Modal titles for the add / edit forms. */
export const REPO_MODAL_TITLE = {
  ADD: "Add repo",
  EDIT: "Edit repo",
} as const;
