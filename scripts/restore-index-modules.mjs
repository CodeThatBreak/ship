#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/** git path (HEAD) -> new camelCase module path under repo root */
const RESTORE_MAP = [
  [
    "components/flows/components/plan/constants/index.ts",
    "components/flows/components/plan/constants/planConstants.ts",
  ],
  [
    "components/flows/components/plan/types/index.ts",
    "components/flows/components/plan/types/planTypes.ts",
  ],
  [
    "components/flows/components/plan/reducer/index.ts",
    "components/flows/components/plan/reducer/planUiReducer.ts",
  ],
  [
    "components/flows/components/plan/hooks/usePlanComposer/index.ts",
    "components/flows/components/plan/hooks/usePlanComposer/planComposerExports.ts",
  ],
  [
    "components/flows/panels/artifacts/index.ts",
    "components/flows/panels/artifacts/artifactExports.ts",
  ],
  [
    "components/flows/flow-status/index.ts",
    "components/flows/flowStatus/flowStatusExports.ts",
  ],
  [
    "components/template-editor/condition-builder/index.ts",
    "components/templateEditor/conditionBuilder/conditionBuilderExports.ts",
  ],
  [
    "lib/engine/nodes/shared/index.ts",
    "lib/engine/nodes/shared/nodeSharedExports.ts",
  ],
  [
    "lib/engine/nodes/kinds/plan/index.ts",
    "lib/engine/nodes/kinds/plan/planExports.ts",
  ],
  [
    "lib/engine/nodes/kinds/build/index.ts",
    "lib/engine/nodes/kinds/build/buildExports.ts",
  ],
  [
    "lib/engine/nodes/kinds/pipeline/index.ts",
    "lib/engine/nodes/kinds/pipeline/pipelineExports.ts",
  ],
  [
    "lib/engine/nodes/kinds/review/index.ts",
    "lib/engine/nodes/kinds/review/reviewExports.ts",
  ],
  [
    "lib/engine/nodes/kinds/resolve/index.ts",
    "lib/engine/nodes/kinds/resolve/resolveExports.ts",
  ],
  [
    "lib/engine/nodes/kinds/start/index.ts",
    "lib/engine/nodes/kinds/start/startExports.ts",
  ],
  [
    "lib/engine/nodes/kinds/merge-request/index.ts",
    "lib/engine/nodes/kinds/mergeRequest/mergeRequestExports.ts",
  ],
  [
    "lib/engine/nodes/kinds/plan/constants/config/index.ts",
    "lib/engine/nodes/kinds/plan/constants/config/planConfigExports.ts",
  ],
  [
    "lib/engine/nodes/kinds/plan/types/index.ts",
    "lib/engine/nodes/kinds/plan/types/planTypeExports.ts",
  ],
  [
    "lib/engine/nodes/kinds/agent/constants/index.ts",
    "lib/engine/nodes/kinds/agent/constants/agentConstantsExports.ts",
  ],
  [
    "lib/engine/nodes/shared/agent/output-error/index.ts",
    "lib/engine/nodes/shared/agent/outputError/outputErrorExports.ts",
  ],
  [
    "lib/db/stores/index.ts",
    "lib/db/stores/storeExports.ts",
  ],
  [
    "lib/engine/harness/index.ts",
    "lib/engine/harness/harnessExports.ts",
  ],
];

const kebabToCamel = (segment) =>
  segment.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

const camelizePathInContent = (content) => {
  return content.replace(/from\s+(['"])([^'"]+)\1/g, (_, q, spec) => {
    if (!spec.startsWith(".")) return `from ${q}${spec}${q}`;
    const next = spec
      .split("/")
      .map((seg, i) => (i === 0 && seg.startsWith(".") ? seg : kebabToCamel(seg)))
      .join("/");
    return `from ${q}${next}${q}`;
  });
};

for (const [gitPath, destPath] of RESTORE_MAP) {
  let content;
  try {
    content = execSync(`git show HEAD:${gitPath}`, { cwd: ROOT, encoding: "utf8" });
  } catch {
    console.warn(`skip missing ${gitPath}`);
    continue;
  }
  content = camelizePathInContent(content);
  content = content.replace(
    "from '../constants'",
    "from '../constants/planConstants'",
  );
  content = content.replace(
    "from '../types'",
    "from '../types/planTypes'",
  );
  const abs = path.join(ROOT, destPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  execSync(`git add ${JSON.stringify(abs)}`, { cwd: ROOT });
}

/** @type {[string, string][]} */
const IMPORT_REPLACEMENTS = [
  ['from "../constants/planConstants/planConstants"', 'from "../constants/planConstants"'],
  ['from "../reducer"', 'from "../reducer/planUiReducer"'],
  ["from '../reducer'", "from '../reducer/planUiReducer'"],
  ['from "./hooks/usePlanComposer"', 'from "./hooks/usePlanComposer/planComposerExports"'],
  ["from './hooks/usePlanComposer'", "from './hooks/usePlanComposer/planComposerExports'"],
  ['from "./flowStatus"', 'from "./flowStatus/flowStatusExports"'],
  ['from "../flowStatus"', 'from "../flowStatus/flowStatusExports"'],
  ['from "./artifacts"', 'from "./artifacts/artifactExports"'],
  ['@/components/shared/dataTable"', '@/components/shared/dataTable/DataTable"'],
  ['from "../conditionBuilder"', 'from "../conditionBuilder/conditionBuilderExports"'],
  ['from "./kinds/plan/planExports"', 'from "./kinds/plan/planExports"'],
  ['from "./kinds/build/buildExports"', 'from "./kinds/build/buildExports"'],
  ['from "../kinds/build/buildExports"', 'from "../kinds/build/buildExports"'],
  ['from "../nodes/shared/nodeSharedExports"', 'from "../nodes/shared/nodeSharedExports"'],
  ['from "../../nodes/shared/nodeSharedExports"', 'from "../../nodes/shared/nodeSharedExports"'],
  ['from "./nodes/shared/nodeSharedExports"', 'from "./nodes/shared/nodeSharedExports"'],
];

const walk = (dir, acc = []) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === ".next") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(ent.name)) acc.push(full);
  }
  return acc;
};

for (const abs of walk(ROOT)) {
  let content = fs.readFileSync(abs, "utf8");
  let next = content;
  for (const [from, to] of IMPORT_REPLACEMENTS) {
    next = next.split(from).join(to);
  }
  if (next !== content) fs.writeFileSync(abs, next);
}

console.log("Restored index modules as camelCase export files.");
