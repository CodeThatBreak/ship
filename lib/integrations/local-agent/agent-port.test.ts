import { describe, expect, it } from "vitest";
import { CursorLocalAgentPort } from "./agent-port";
import { AgentRunWorkspaceError } from "../../engine/ports/agent-errors";

describe("CursorLocalAgentPort.start", () => {
  it("throws when neither cwd nor workspace is set", async () => {
    const port = new CursorLocalAgentPort();
    await expect(
      port.start({
        prompt: "hi",
        name: "test",
      }),
    ).rejects.toBeInstanceOf(AgentRunWorkspaceError);
  });
});
