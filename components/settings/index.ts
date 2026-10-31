/**
 * The settings feature's public surface (barrel): query options, types, and
 * page islands consumed outside the settings area.
 */
export {
  settingsQueryOptions,
  reposQueryOptions,
  gitHostsQueryOptions,
  fetchSettings,
  fetchRepos,
} from "./queries";
export { useSettingsQuery } from "./hooks/use-settings-query";
export { useReposQuery } from "./hooks/use-repos-query";
export { useSettingsPageError } from "./hooks/use-settings-page-error";
export { GeneralSettingsSkeleton } from "./components/GeneralSettingsSkeleton";
export { GeneralSettingsPage } from "./general/GeneralSettingsPage";
export { RepositoriesSettingsPage } from "./repos/RepositoriesSettingsPage";
export { IntegrationsSettingsPage } from "./integrations/IntegrationsSettingsPage";
export type { Repo, Harness, HarnessMode, Settings } from "./context";
