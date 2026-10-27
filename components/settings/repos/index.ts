/**
 * Settings → Repositories section: the repo registry plus the add/edit modal.
 *
 * Structure (feature-local, mirrors the integrations feature — AGENTS.md §1.2):
 * - components/  presentational subcomponents, one per file
 * - hooks/       TanStack Query hooks (mutations, policy detection) + the repo form state hook
 * - constants.ts feature constants (defaults, badge copy, modal titles)
 * - paths.ts     home-path display helper
 * - types.ts     feature-local types
 */
export { ReposSection } from "./ReposSection";
