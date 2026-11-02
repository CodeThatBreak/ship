#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

const kebabToCamel = (segment) =>
  segment.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

const camelizeImportPath = (spec) => {
  if (spec.startsWith("@/")) {
    const rest = spec.slice(2);
    return `@/${rest.split("/").map(kebabToCamel).join("/")}`;
  }
  if (spec.startsWith(".")) {
    return spec
      .split("/")
      .map((seg, i) => (i === 0 && seg.startsWith(".") ? seg : kebabToCamel(seg)))
      .join("/");
  }
  return spec;
};

/** @type {Record<string, string>} */
const BARREL_TO_MODULE = {
  "@/lib/db": "@/lib/db/app",
  "@/lib/settings": "@/lib/settings/settingsService",
  "@/lib/repos": "@/lib/repos/repoService",
  "@/lib/artifacts": "@/lib/artifacts/artifactService",
  "@/lib/contracts": "@/lib/contracts/contractService",
  "@/lib/comments": "@/lib/comments/commentService",
  "@/lib/status": "@/lib/status/statusService",
  "@/lib/jsonata": "@/lib/jsonata/eval",
  "@/lib/model-catalog": "@/lib/modelCatalog/modelCatalogService",
  "@/lib/modelCatalog": "@/lib/modelCatalog/modelCatalogService",
  "@/lib/engine/tasks": "@/lib/engine/tasks/taskService",
  "@/lib/engine/graph": "@/lib/engine/graph/graphService",
  "./stores": "./stores/storeExports",
  "./index": "./app",
  "../index": "../app",
  "../lib/settings": "../lib/settings/settingsService",
};

/**
 * When an import targets a directory barrel (deleted index.ts), append the
 * concrete export module filename.
 * @type {Array<[RegExp, string]>}
 */
const RELATIVE_DIR_BARRELS = [
  [/\/shared$/, "/shared/nodeSharedExports"],
  [/\/harness$/, "/harness/harnessExports"],
  [/\/mergeRequest$/, "/mergeRequest/mergeRequestExports"],
  [/\/pipeline$/, "/pipeline/pipelineExports"],
  [/\/review$/, "/review/reviewExports"],
  [/\/resolve$/, "/resolve/resolveExports"],
  [/\/start$/, "/start/startExports"],
  [/\/outputError$/, "/outputError/outputErrorExports"],
  [/\/db\/stores$/, "/db/stores/storeExports"],
];

const applyDirBarrels = (spec) => {
  let next = spec;
  for (const [pattern, replacement] of RELATIVE_DIR_BARRELS) {
    if (
      pattern.source === "\\/shared$" &&
      !next.includes("/nodes/shared") &&
      !next.includes("/engine/nodes/shared")
    ) {
      continue;
    }
    const candidate = next.replace(pattern, replacement);
    if (candidate !== next) next = candidate;
  }
  return next;
};

const fixImportSpec = (spec) => {
  let next = camelizeImportPath(spec);
  if (BARREL_TO_MODULE[next]) next = BARREL_TO_MODULE[next];
  if (BARREL_TO_MODULE[spec]) next = BARREL_TO_MODULE[spec];
  if (next === "@/lib/db" || spec === "@/lib/db") next = "@/lib/db/app";
  if (/^(?:@\/lib|\.\.)[^'"]*\/db$/.test(next) && !next.endsWith("/db/app")) {
    next = `${next}/app`;
  }
  next = applyDirBarrels(next);
  if (next === "./constants/config") next = "./constants/config/planConfigExports";
  return next;
};

const walk = (dir, acc = []) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === ".next") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx|mjs)$/.test(ent.name)) acc.push(full);
  }
  return acc;
};

const replaceImportSpecs = (content) =>
  content.replace(/(from\s+['"])([^'"]+)(['"])/g, (_, pre, spec, post) => {
    const next = fixImportSpec(spec);
    return pre + next + post;
  });

const fixFile = (abs) => {
  let content = fs.readFileSync(abs, "utf8");
  const before = content;
  content = replaceImportSpecs(content);
  content = content.replace(
    /(import\s+['"])([^'"]+)(['"])/g,
    (_, pre, spec, post) => pre + fixImportSpec(spec) + post,
  );
  content = content.replace(
    /(import\s*\(\s*['"])([^'"]+)(['"]\s*\))/g,
    (_, pre, spec, post) => pre + fixImportSpec(spec) + post,
  );
  content = content.replace(
    /(new URL\s*\(\s*['"])([^'"]+)(['"])/g,
    (_, pre, spec, post) => pre + fixImportSpec(spec) + post,
  );
  if (content !== before) fs.writeFileSync(abs, content);
};

for (const abs of walk(ROOT)) fixFile(abs);
console.log("Import path fix complete.");
