/** App Router paths reused by the shell, links, and redirects (§2.7). */
export const APP_ROUTES = {
  TASKS: "/",
  FLOWS: "/flows",
  TEMPLATES: "/templates",
  TEMPLATE_NODES: "/templates/nodes",
  SETTINGS: "/settings",
  SETTINGS_REPOSITORIES: "/settings/repositories",
  SETTINGS_INTEGRATIONS: "/settings/integrations",
} as const;

export type AppRoute = (typeof APP_ROUTES)[keyof typeof APP_ROUTES];
