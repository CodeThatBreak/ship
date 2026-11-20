import "server-only";

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs?: number;
  timedOut: boolean;
}

/** The LAST few lines — for stdout, where incidental logging piles up. */
export const firstLines = (text: string): string => {
  const t = (text ?? "").trim();
  return t ? t.split("\n").slice(-4).join("\n") : "";
};

/** The FIRST few lines — for stderr, where the actual diagnostic lives. */
export const headLines = (text: string): string => {
  const t = (text ?? "").trim();
  return t ? t.split("\n").slice(0, 8).join("\n") : "";
};

// ── execa plumbing (dynamic import: execa is ESM-only) ───────────────────────

export const runProcess = async (
  bin: string,
  args: string[],
  opts: { input: string; timeoutMs: number; cwd: string; env: Record<string, string> },
): Promise<ExecResult> => {
  const started = Date.now();
  try {
    const { execa } = (await import("execa")) as unknown as {
      execa: (
        file: string,
        args: string[],
        o: Record<string, unknown>,
      ) => Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; failed: boolean }>;
    };
    const res = await execa(bin, args, {
      input: opts.input,
      timeout: opts.timeoutMs,
      cwd: opts.cwd,
      env: opts.env,
      extendEnv: false,
      killSignal: "SIGKILL",
      stripFinalNewline: false,
      reject: false,
      windowsHide: true,
    });
    return {
      exitCode: res.exitCode ?? (res.failed ? 1 : 0),
      stdout: String(res.stdout ?? ""),
      stderr: String(res.stderr ?? ""),
      durationMs: Date.now() - started,
      timedOut: Boolean(res.timedOut),
    };
  } catch (e: unknown) {
    // thrown before execution (e.g. binary not found) — execa's promise API
    // with reject:false still throws in that case
    throw new Error(
      `${bin} failed to launch — ensure it is installed and on PATH (${e instanceof Error ? e.message : String(e)})`);
  }
};
