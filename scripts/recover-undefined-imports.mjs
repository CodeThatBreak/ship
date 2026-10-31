#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

const kebabToCamel = (segment) =>
  segment.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

const camelizeImportPath = (spec) => {
  if (spec.startsWith("@/")) {
    return `@/${spec
      .slice(2)
      .split("/")
      .map(kebabToCamel)
      .join("/")}`;
  }
  if (spec.startsWith(".")) {
    return spec
      .split("/")
      .map((seg, i) => (i === 0 && seg.startsWith(".") ? seg : kebabToCamel(seg)))
      .join("/");
  }
  return spec;
};

const UI_SEGMENT = {
  alertDialog: "alert-dialog",
  buttonGroup: "button-group",
  codeBlock: "code-block",
  dropdownMenu: "dropdown-menu",
  inputGroup: "input-group",
  messageScroller: "message-scroller",
  scrollArea: "scroll-area",
};

const fixUiSegment = (spec) => {
  if (!spec.includes("ui/")) return spec;
  const parts = spec.split("/");
  const last = parts[parts.length - 1];
  if (UI_SEGMENT[last]) parts[parts.length - 1] = UI_SEGMENT[last];
  return parts.join("/");
};

const rewriteImports = (content) =>
  content.replace(/(from\s+['"])([^'"]+)(['"])/g, (_, pre, spec, post) => {
    let next = camelizeImportPath(spec);
    next = fixUiSegment(next);
    if (/^(?:@\/lib|\.\.)[^'"]*\/db$/.test(next)) next = `${next}/app`;
    if (next === "@/lib/db") next = "@/lib/db/app";
    return pre + next + post;
  });

/** @type {Map<string, string>} new rel -> old rel at HEAD */
const renameMap = new Map();
const status = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" });
for (const line of status.split("\n")) {
  const m = line.match(/^R\S*\s+(.+)\s+->\s+(.+)$/);
  if (m) renameMap.set(m[2], m[1]);
}

const corrupted = execSync(
  `rg -l "from 'undefined'|from \\"undefined\\"" --glob '*.{ts,tsx}' .`,
  { cwd: ROOT, encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean)
  .map((p) => p.replace(/^\.\//, ""));

for (const rel of corrupted) {
  const headPath = renameMap.get(rel) ?? rel;
  let content;
  try {
    content = execSync(`git show ${JSON.stringify(`HEAD:${headPath}`)}`, { cwd: ROOT, encoding: "utf8" });
  } catch {
    console.warn(`skip restore ${rel} (no HEAD:${headPath})`);
    continue;
  }
  content = rewriteImports(content);
  content = content.replace(/@\/lib\/db(?!\/)/g, "@/lib/db/app");
  fs.writeFileSync(path.join(ROOT, rel), content);
}
console.log(`Restored ${corrupted.length} corrupted files from HEAD.`);
