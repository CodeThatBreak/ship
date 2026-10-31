#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

const git = (cmd) => execSync(cmd, { cwd: ROOT, encoding: "utf8" });

const renameMap = new Map();
for (const line of git("git status --porcelain").split("\n")) {
  const m = line.match(/^R\S*\s+(.+)\s+->\s+(.+)$/);
  if (m) renameMap.set(m[2], m[1]);
}

const corrupted = git(
  `rg -l "from 'undefined'|from \\"undefined\\"" --glob '*.{ts,tsx}' .`,
)
  .split("\n")
  .filter(Boolean)
  .map((p) => p.replace(/^\.\//, ""));

const headExists = (headPath) => {
  try {
    execSync(`git cat-file -e HEAD:${JSON.stringify(headPath)}`, {
      cwd: ROOT,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};

let restored = 0;
for (const rel of corrupted) {
  const headPath = renameMap.get(rel) ?? rel;
  if (!headExists(headPath)) {
    continue;
  }
  if (rel === headPath) {
    execSync(`git checkout HEAD -- ${JSON.stringify(rel)}`, { cwd: ROOT, stdio: "ignore" });
  } else {
    const content = execSync(`git show HEAD:${JSON.stringify(headPath)}`, {
      cwd: ROOT,
      encoding: "utf8",
    });
    fs.writeFileSync(path.join(ROOT, rel), content);
  }
  restored += 1;
}
console.log(`Restored ${restored}/${corrupted.length} files via git checkout/show.`);
