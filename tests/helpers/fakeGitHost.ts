import { FakeGitHost } from "@/lib/engine/ports/gitHost/fakeGitHost";
import { gitHostRegistry } from "@/lib/engine/ports/gitHost";

/**
 * The characterization-test adapter over the promoted fake git host
 * (`lib/engine/ports/gitHost/fakeGitHost.ts`): the dry-run harness registers
 * the port's default identity (claims no repos), while these tests construct
 * a `claimsAllRepos` instance under the legacy `fake-git-host` key so
 * `forRepo` resolves it in the test database.
 */
export { FakeGitHost };
export type { GitHostCall } from "@/lib/engine/ports/gitHost/types/fakeGitHost";

/**
 * Register a fresh fake into the global git-host registry. The registry
 * singleton forbids duplicate kinds, so one call per test file (top level,
 * matching the repo's existing stub-port convention).
 */
export const registerFakeGitHost = (): FakeGitHost => {
  const fake = new FakeGitHost({
    kind: "fake-git-host",
    claimsAllRepos: true,
  });
  gitHostRegistry.register(fake);
  return fake;
};
