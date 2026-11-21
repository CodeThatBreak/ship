import "server-only";

import { gitHostRegistry } from "../engine/ports/gitHost";
import { FakeGitHost } from "../engine/ports/gitHost/fakeGitHost";
import { GitLabHostService } from "../integrations/gitlab/gitHost";
import { gitLab } from "../integrations/gitlab/singleton";

let wired = false;

/** Register built-in git-host adapters once {@link Database} is constructed. */
export const wireGitHostBuiltins = (): void => {
  if (wired) return;
  wired = true;
  gitHostRegistry.register(new GitLabHostService(gitLab));
  // the dry-run simulation harness (task 27, design §7): a distinct registry
  // key that claims NO repos — `forRepo` never resolves it; a dry-run flow's
  // host operations select it explicitly by execution mode (`gitHostFor`)
  gitHostRegistry.register(new FakeGitHost());
};
