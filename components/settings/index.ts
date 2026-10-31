/**
 * The settings feature's public surface (barrel): the small server-state
 * fetchers and their types — consumed outside the settings area (e.g. the
 * template gallery's webhook payload dialog reads repos + harnesses).
 * Deep imports across features are forbidden — import from here.
 */
export { fetchSettings, fetchRepos } from "./queries";
export { SettingsProvider, useSettings } from "./context";
export type { Repo, Harness, HarnessMode } from "./context";
