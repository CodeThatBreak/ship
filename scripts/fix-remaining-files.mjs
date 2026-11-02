#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/** current path -> HEAD path */
const HEAD_PATH = {
  "hooks/useFlowChat.ts": "hooks/use-flow-chat.ts",
  "components/chat/composerConfig.ts": "components/chat/composer-config.ts",
  "components/flows/workflowGraph/WorkflowGraph.tsx":
    "components/flows/workflow-graph/WorkflowGraph.tsx",
  "lib/engine/nodes/shared/templateComposer.ts":
    "lib/engine/nodes/shared/template-composer.ts",
  "lib/engine/nodes/shared/templateRenderer.ts":
    "lib/engine/nodes/shared/template-renderer.ts",
  "lib/engine/nodes/kinds/agent/agentNode.ts":
    "lib/engine/nodes/kinds/agent/agent-node.ts",
  "lib/engine/nodes/kinds/plan/planStore.ts":
    "lib/engine/nodes/kinds/plan/plan-store.ts",
  "lib/engine/nodes/kinds/plan/planNode.ts":
    "lib/engine/nodes/kinds/plan/plan-node.ts",
  "lib/engine/nodes/kinds/plan/planNode.test.ts":
    "lib/engine/nodes/kinds/plan/plan-node.test.ts",
  "lib/engine/nodes/kinds/plan/planContext.ts":
    "lib/engine/nodes/kinds/plan/plan-context.ts",
  "lib/engine/nodes/kinds/plan/planContext.test.ts":
    "lib/engine/nodes/kinds/plan/plan-context.test.ts",
  "lib/engine/nodes/kinds/plan/planContract.ts":
    "lib/engine/nodes/kinds/plan/plan-contract.ts",
  "lib/engine/nodes/kinds/plan/planContract.test.ts":
    "lib/engine/nodes/kinds/plan/plan-contract.test.ts",
  "lib/engine/nodes/kinds/plan/planPrompt.ts":
    "lib/engine/nodes/kinds/plan/plan-prompt.ts",
  "lib/engine/nodes/kinds/plan/planPrompt.test.ts":
    "lib/engine/nodes/kinds/plan/plan-prompt.test.ts",
  "lib/engine/nodes/kinds/plan/planSplit.ts":
    "lib/engine/nodes/kinds/plan/plan-split.ts",
  "lib/engine/nodes/kinds/plan/planAgentSessions.ts":
    "lib/engine/nodes/kinds/plan/plan-agent-sessions.ts",
  "lib/engine/nodes/kinds/plan/branchRefinement.ts":
    "lib/engine/nodes/kinds/plan/branch-refinement.ts",
  "lib/engine/nodes/kinds/plan/branchRefinement.test.ts":
    "lib/engine/nodes/kinds/plan/branch-refinement.test.ts",
  "lib/engine/nodes/kinds/plan/planSplitUnitsDemo.test.ts":
    "lib/engine/nodes/kinds/plan/plan-split-units-demo.test.ts",
  "lib/engine/nodes/kinds/plan/planTurnEnvelope.test.ts":
    "lib/engine/nodes/kinds/plan/plan-turn-envelope.test.ts",
  "lib/engine/nodes/kinds/plan/planStore.test.ts":
    "lib/engine/nodes/kinds/plan/plan-store.test.ts",
  "tests/planDiff.test.ts": "tests/plan-diff.test.ts",
};

const kebabToCamel = (segment) =>
  segment.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

const rewrite = (content) =>
  content.replace(/(from\s+['"])([^'"]+)(['"])/g, (_, pre, spec, post) => {
    let next = spec;
    if (next.startsWith("@/") || next.startsWith(".")) {
      next = next
        .split("/")
        .map((seg, i) =>
          i === 0 && (seg.startsWith("@") || seg.startsWith(".")) ? seg : kebabToCamel(seg),
        )
        .join("/");
      if (next.startsWith("@/")) {
        next = `@/${next
          .slice(2)
          .split("/")
          .map(kebabToCamel)
          .join("/")}`;
      }
    }
    if (/^(?:@\/lib|\.\.)[^'"]*\/db$/.test(next)) next = `${next}/app`;
    if (next === "@/lib/db") next = "@/lib/db/app";
    if (next.includes("nodes/shared") && !next.includes("nodeSharedExports")) {
      next = next.replace(/nodes\/shared$/, "nodes/shared/nodeSharedExports");
    }
    if (next.includes("kinds/plan") && !next.includes("planExports") && !next.includes("/plan-")) {
      next = next.replace(/kinds\/plan$/, "kinds/plan/planExports");
    }
    return pre + next + post;
  });

for (const [dest, head] of Object.entries(HEAD_PATH)) {
  let content;
  try {
    content = execSync(`git show HEAD:${head}`, { cwd: ROOT, encoding: "utf8" });
  } catch {
    console.warn(`skip ${dest}`);
    continue;
  }
  fs.writeFileSync(path.join(ROOT, dest), rewrite(content));
}
console.log("Fixed remaining HEAD-mapped files.");
