/**
 * Scratch-DB bootstrap for the prompt-parity check: points DATABASE_PATH at a
 * throwaway file in the OS temp dir BEFORE the engine modules load (the app's
 * DB singleton opens the file through lib/config.ts on import). Unused
 * elsewhere — verification-only (no test runner in this repo, D5).
 */
import fs from "fs";
import os from "os";
import path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-prompt-parity-"));
process.env.DATABASE_PATH = path.join(dir, "parity.db");
// NoEnv assignment must bypass Next's readonly process.env typing (next-env.d.ts)
Object.assign(process.env, { NODE_ENV: "test" });
