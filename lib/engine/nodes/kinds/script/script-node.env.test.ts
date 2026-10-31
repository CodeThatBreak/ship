import { describe, expect, it, vi } from "vitest";

const execaMock = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    stdout: '{"ok":true}\n',
    stderr: "",
    timedOut: false,
    failed: false,
  })),
);

vi.mock("execa", () => ({ execa: execaMock }));

process.env.DEVFLOW_SCRIPT_ENV_PROBE = "must-not-leak";

const { runScriptProcessForTests } = await import("./script-node");

describe("script child process env", () => {
  it("does not inherit non-allowlisted server environment variables", async () => {
    await runScriptProcessForTests("node", ["-e", "0"], {
      input: "{}",
      timeoutMs: 1_000,
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        DEVFLOW_INPUT: "{}",
        DEVFLOW_OUTPUT: "/tmp/devflow-out-test.json",
      },
    });

    expect(execaMock).toHaveBeenCalledTimes(1);
    const opts = execaMock.mock.calls[0][2] as { env: Record<string, string>; extendEnv?: boolean };
    expect(opts.extendEnv).toBe(false);
    expect(opts.env.DEVFLOW_SCRIPT_ENV_PROBE).toBeUndefined();
  });
});
