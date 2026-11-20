import type { GitHostRegistry } from "../gitHostRegistry";

/** Repo-scoped git host resolution (injected into nodes that call GitLab APIs). */
export type GitHostResolver = Pick<GitHostRegistry, "forRepo">;
