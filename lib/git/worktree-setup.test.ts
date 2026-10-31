import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

const execFileMock = vi.fn();

vi.mock("child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
  spawn: vi.fn(),
}));

describe("copyDirCoW (CR-103)", () => {
  const tmpDirs: string[] = [];
  let copyDirCoW: (src: string, dst: string) => Promise<void>;

  beforeEach(async () => {
    vi.resetModules();
    execFileMock.mockReset();
    const mod = await import("./worktree-setup");
    copyDirCoW = mod.copyDirCoW;
  });

  afterEach(async () => {
    await Promise.all(tmpDirs.map((d) => fs.promises.rm(d, { recursive: true, force: true })));
    tmpDirs.length = 0;
  });

  it("removes partial dst and throws on cp timeout instead of blocking cpSync", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-copy-"));
    tmpDirs.push(root);
    const src = path.join(root, "src");
    const dst = path.join(root, "dst");
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, "file.txt"), "x");

    execFileMock.mockImplementation(
      (_file: unknown, _args: unknown, opts: unknown, cb?: unknown) => {
        const callback = typeof opts === "function" ? opts : cb;
        const err = Object.assign(new Error("timed out"), { killed: true });
        (callback as (err: Error) => void)?.(err as NodeJS.ErrnoException);
        return {} as ReturnType<typeof import("child_process").execFile>;
      },
    );

    const cpSync = vi.spyOn(fs, "cpSync");

    await expect(copyDirCoW(src, dst)).rejects.toThrow(/timed out/i);
    expect(fs.existsSync(dst)).toBe(false);
    expect(cpSync).not.toHaveBeenCalled();

    cpSync.mockRestore();
  });
});
