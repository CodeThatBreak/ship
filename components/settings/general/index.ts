/**
 * Settings → General: execution defaults, secrets and custom-node settings.
 *
 * Structure (feature-local, mirrors the repos feature — AGENTS.md §1.2):
 * - components/  presentational subcomponents, one per file
 * - hooks/       settings PATCH mutations + the section state hooks
 * - constants.ts feature constants (mode metadata, hints, placeholders)
 * - types.ts     feature-local types
 */
export { GeneralSection } from "./GeneralSection";
