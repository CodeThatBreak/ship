import { RUN_MODE } from "@/constants/execution";
import { FakeAgentPort } from "@/lib/engine/ports/agentPort/fakeAgentPort";
import { agentPortRegistry } from "@/lib/engine/ports/agentPort";

/**
 * The characterization-test adapter over the promoted fake agent port
 * (`lib/engine/ports/agentPort/fakeAgentPort.ts`): the dry-run harness
 * registers the port's default identity, while these tests construct a
 * cloud-mode instance under the legacy `fake-overhaul` key so
 * `forMode("cloud")` resolves it after `default_harness` is set.
 */
export { FakeAgentPort };
export type { AgentCall } from "@/lib/engine/ports/agentPort/types/fakeAgentPort";

/**
 * Register a fresh fake into the global registry and select it as the default
 * harness so `forMode("cloud")` resolves it. The registry singleton forbids
 * duplicate kinds and the DB singleton forbids a second process-wide
 * `default_harness`, so one call per test file (top level, like the repo's
 * existing stub-port tests).
 */
export const registerFakeAgentPort = (setDefaultHarness: (value: string) => void): FakeAgentPort => {
  const fake = new FakeAgentPort({
    kind: "fake-overhaul",
    harness: "fake-overhaul",
    execMode: RUN_MODE.CLOUD,
  });
  agentPortRegistry.register(fake);
  setDefaultHarness(fake.harness);
  return fake;
};
