import "server-only";

import { gitHostRegistry } from "../engine/ports/gitHost";
import { GitLabHostService } from "../integrations/gitlab/gitHost";
import { gitLab } from "../integrations/gitlab/singleton";

let wired = false;

/** Register built-in git-host adapters once {@link Database} is constructed. */
export const wireGitHostBuiltins = (): void => {
  if (wired) return;
  wired = true;
  gitHostRegistry.register(new GitLabHostService(gitLab));
};
