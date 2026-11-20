import "server-only";

import { validateStandardAgentOutput } from "../../../shared/agentOutput/utils/standardOutput";
import { BuildProgressReport } from "../schema";

/**
 * Parse the build agent's trailing ` ```json build-progress` ` report
 * (step 05 — the fence is validated through the shared agent-output
 * machinery): the parsed `{ completed }` report, or NULL when the block is
 * missing or unparseable. Null is a FIRST-CLASS state the build def turns
 * into a failed node when steps are still pending — never a silent empty
 * list.
 */
export const parseBuildProgressReport = (text: string): BuildProgressReport | null => {
  const fence = text.match(/```json build-progress\s*\n([\s\S]*?)```/);
  if (!fence) return null;
  try {
    return validateStandardAgentOutput({
      label: "build",
      text: fence[1] ?? "",
      schema: BuildProgressReport,
      noJsonNote: "the build-progress block must be a single JSON object",
      mismatchNote: "the build-progress block violated its schema",
    });
  } catch {
    return null;
  }
};
