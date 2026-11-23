import "server-only";

import type { Prisma } from "@prisma/client";
import { db } from "../../db/app";
import { NodeTemplateRow } from "../../db/rows";
import { buildNodeContracts, inheritedInputFields, makeAddressesOutput } from "./lintContracts";
import { lintDecisionJsonata, lintEdgeConditions, lintHttpJsonata, lintInputMapJsonata, lintNeedsSatisfiability } from "./lintExpressions";
import { lintRef } from "./lintRefs";
import { templateRefs } from "./utils/templateRefs";
import { shallowMerge } from "./utils/shallowMerge";
import type { LintProblem } from "@/types/templateLint";
import type { CatalogEntry, LintEdge, LintNode, TaskUniverse } from "./lintTypes";

/**
 * Build-time checks for declarative templates (§5): every `{{nodes.X.output.Y}}`
 * reference and JSONata expression statically resolves against the template's
 * contracts before a template saves / imports. The base roots are always known
 * (task / repo / flow / trigger.payload), node outputs are known when
 * the upstream node's contract enumerates its fields (declarative kinds; built-in
 * outputs stay path-checked only).
 *
 * The `{{task.*}}` universe comes in per template — the caller (TemplateStore)
 * resolves `trigger.taskType` → task provider → `contextFields` and passes it
 * here, so this module stays pure data with no runtime class instantiation
 * (keeps the store import-cycle free): declarative output contracts are derived
 * straight from the node_templates config JSON.
 *
 * `lintTemplate` is the orchestrator; the rules live in their own modules:
 * `lintContracts` (output contracts + trigger/start-contract checks),
 * `lintRefs` ({{...}} reference rules),
 * `lintExpressions` (JSONata checks + the fact-need satisfiability walk),
 * `lintNodeTrigger`, `outputFields`.
 */

/** One lint problem, structured (Phase 3): where it came from — `node "x"` /
 * `edge a → b` — the offending `{{ref}}` when one is, and the readable
 * message (without the `where:` prefix; the joined string re-attaches it so
 * save/import messages stay byte-identical). The validate endpoint returns
 * these; the editor underlines the offending ref where it's typed.
 *
 * Phase 5 adds the machine-addressable coordinates: `nodeKey` / `edgeIndex`
 * point the canvas's error badges and the drawer's jump-to-field at the
 * offending element without parsing the `where` string.
 */
export type { LintProblem } from "@/types/templateLint";

export type { TaskUniverse } from "./lintTypes";

const joinProblems = (problems: LintProblem[]): string =>
  problems.map((p) => (p.where ? `${p.where}: ${p.message}` : p.message)).join("\n");

/**
 * Validate a template draft. Collects every problem into one readable message
 * (the store throws it on save/import); returns `error: null` when clean.
 * The problems are also returned structured (where / ref / message) for the
 * live validation endpoint.
 */
export const lintTemplate = async (
  nodes: LintNode[],
  edges: LintEdge[],
  catalog: Record<string, CatalogEntry>, // nodeTemplateId → entry
  task: TaskUniverse | null = null, // trigger.taskType → provider fields (null = unknown provider — free pass)
): Promise<{ error: string | null; problems: LintProblem[] }> => {
  const problems: LintProblem[] = [];
  const byKey = new Map(nodes.map((n) => [n.key, n]));

  // contract lookup for {{nodes.<key>.output.<field>}} references
  const contractOfKey = buildNodeContracts(nodes, catalog, problems);
  const addressesOutput = makeAddressesOutput(contractOfKey);

  for (const n of nodes) {
    const nt = catalog[n.nodeTemplateId];

    // per-field input_map expressions must compile
    lintInputMapJsonata(n, problems);

    if (nt) {
      const inheritedFields = inheritedInputFields(edges, n, contractOfKey);

      // {{...}} template refs in declarative definitions
      for (const ref of templateRefs(nt.config, n.config)) {
        lintRef(`node "${n.key}"`, ref, { problems, byKey, contractOfKey, addressesOutput, inHttp: nt.kind === "http", inheritedFields, task, nodeKey: n.key });
      }
      // instance-level config overrides (agent prompt override) may add refs
      if (nt.kind === "agent" && typeof n.config?.prompt === "string") {
        for (const ref of templateRefs(n.config.prompt, "")) {
          lintRef(`node "${n.key}" config.prompt`, ref, { problems, byKey, contractOfKey, addressesOutput, inHttp: false, inheritedFields, task, nodeKey: n.key });
        }
      }
      const cfg = shallowMerge(n.config, nt.config);
      // decision definitions: the pass-down map compiles (any source); per-choice
      // conditions when source=expression
      if (nt.kind === "decision") {
        lintDecisionJsonata(cfg, n, problems);
      }
      // http response_map compiles
      if (nt.kind === "http") {
        lintHttpJsonata(cfg, n, problems);
      }
    }
  }

  // edge + loop conditions compile (not on decision branches — those gate on labels)
  lintEdgeConditions(edges, nodes, catalog, byKey, contractOfKey, addressesOutput, problems);

  // the declarative fact needs (task 14, design §4.1): every declared `needs`
  // entry must be statically satisfiable by some upstream node's
  // `produces`/`effects` declarations (graph walk over declarations only)
  lintNeedsSatisfiability(nodes, edges, catalog, problems);

  return { error: problems.length ? joinProblems(problems) : null, problems };
};

/**
 * Catalog entries behind a template draft, straight off node_templates rows.
 */
export const catalogForNodeTemplateIds = async (
  ids: string[],
  tx?: Prisma.TransactionClient,
): Promise<Record<string, { kind: string; config: unknown; key: string; isBuiltin: boolean }>> => {
  const out: Record<string, { kind: string; config: unknown; key: string; isBuiltin: boolean }> = {};
  if (!ids.length) return out;
  const rows = await (tx ?? db.prisma).nodeTemplate.findMany({
    where: { id: { in: ids } },
    select: { id: true, key: true, kind: true, config: true, isBuiltin: true },
  });
  for (const row of rows) {
    const config = NodeTemplateRow.shape.config.safeParse(row.config);
    out[row.id] = {
      kind: row.kind,
      config: config.success && config.data ? config.data : {},
      key: row.key,
      isBuiltin: row.isBuiltin,
    };
  }
  return out;
};
