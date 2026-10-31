#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/** shadcn files stay kebab-case — undo accidental camelCase in import paths. */
const UI_SEGMENT = {
  alertDialog: "alert-dialog",
  buttonGroup: "button-group",
  codeBlock: "code-block",
  dropdownMenu: "dropdown-menu",
  inputGroup: "input-group",
  messageScroller: "message-scroller",
  scrollArea: "scroll-area",
};

const walk = (dir, acc = []) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === ".next") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(ent.name)) acc.push(full);
  }
  return acc;
};

const fixUiImports = (spec) => {
  if (spec.includes("/ui/") || spec.includes("../ui/") || spec.endsWith("/ui")) {
    const parts = spec.split("/");
    const last = parts[parts.length - 1];
    if (UI_SEGMENT[last]) {
      parts[parts.length - 1] = UI_SEGMENT[last];
      return parts.join("/");
    }
  }
  return spec;
};

for (const abs of walk(ROOT)) {
  let content = fs.readFileSync(abs, "utf8");
  const next = content.replace(
    /(from\s+['"])([^'"]+)(['"])/g,
    (_, pre, spec, post) => pre + fixUiImports(spec) + post,
  );
  if (next !== content) fs.writeFileSync(abs, next);
}
console.log("UI import paths restored.");
