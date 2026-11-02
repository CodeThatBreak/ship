#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

const kebabToCamel = (segment) =>
  segment.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

const rewriteImports = (content) =>
  content.replace(/(from\s+['"])([^'"]+)(['"])/g, (_, pre, spec, post) => {
    let next = spec;
    if (next.startsWith("@/")) {
      next = `@/${next
        .slice(2)
        .split("/")
        .map(kebabToCamel)
        .join("/")}`;
    } else if (next.startsWith(".")) {
      next = next
        .split("/")
        .map((seg, i) => (i === 0 && seg.startsWith(".") ? seg : kebabToCamel(seg)))
        .join("/");
    }
    if (/^(?:@\/lib|\.\.)[^'"]*\/db$/.test(next)) next = `${next}/app`;
    if (next === "@/lib/db") next = "@/lib/db/app";
    return pre + next + post;
  });

const renames = [];
for (const line of execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" }).split("\n")) {
  const m = line.match(/^R\S*\s+(.+)\s+->\s+(.+)$/);
  if (m) renames.push({ old: m[1], new: m[2] });
}

for (const { old: oldPath, new: newPath } of renames) {
  let content;
  try {
    content = execSync(`git show ${JSON.stringify(`HEAD:${oldPath}`)}`, {
      cwd: ROOT,
      encoding: "utf8",
    });
  } catch {
    continue;
  }
  fs.mkdirSync(path.dirname(path.join(ROOT, newPath)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, newPath), rewriteImports(content));
}
console.log(`Rewrote ${renames.length} renamed files from HEAD.`);
