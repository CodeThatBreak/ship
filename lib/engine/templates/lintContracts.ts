import "server-only";

import { lintStartContract } from "../nodes/kinds/start/contract";
import { nodeRegistry } from "../nodes/registry";
import { fanoutOf } from "./nodeConfig";
import { lintNodeTrigger } from "./lintNodeTrigger";
import { outputFieldsFor } from "./outputFields";
import { shallowMerge } from "./utils/shallowMerge";
import type { LintProblem } from "@/types/templateLint";
import type { AddressesOutput, CatalogEntry, LintEdge, LintNode, NodeContract } from "./lintTypes";

/**
 * The per-node output-contract map the ref and condition rules resolve
 * against: for every node the merged (definition + instance) config's
 * published fields, plus the trigger-vocabulary and start-contract problems
 * that surface while the contract is built (same loop, same problem order
 * as the pre-split orchestrator).
 */
export const buildNodeContracts = (
  nodes: LintNode[],
  catalog: Record<string, CatalogEntry>,
  problems: LintProblem[],
): Map<string, NodeContract> => {
  const contractOfKey = new Map<string, NodeContract>();
  for (const n of nodes) {
    lintNodeTrigger(`node "${n.key}"`, n.trigger, problems, n.key);
    const nt = catalog[n.nodeTemplateId];
    if (!nt) continue; // validated() already reports unknown node templates
    const mergedConfig = shallowMerge(nt.config, n.config);
    let fields = outputFieldsFor(nt.kind, mergedConfig);
    // ── fan-out rule 4: upstream-contract statics use the EFFECTIVE fan-out
    // contract of the referenced node — whole ⇒ the declared schema;
    // steps/from-plan ⇒ the aggregate shape ({{...output.steps.*}} is the
    // only addressable path, so downstream mappings are stable across plan
    // revisions — rev 3 decision)
    if (fanoutOf(mergedConfig).mode !== "whole") fields = ["steps"];
    contractOfKey.set(n.key, { fields, kind: nt.kind });
    // the entry contract declaration itself is validated here (loud, readable)
    if (nt.isBuiltin && nt.key === nodeRegistry.entryKey()) {
      for (const message of lintStartContract(mergedConfig, `node "${n.key}"`)) {
        problems.push({ where: "", message, nodeKey: n.key });
      }
    }
  }
  return contractOfKey;
};

/**
 * The static `{{nodes.<key>.output.<field>}}` address check: refs to unknown
 * nodes are caught by the ref rules; refs into a known node must stay under
 * `output` and (when the contract enumerates its fields) name a declared
 * field — the wildcard `.*` and free-form contracts free-pass.
 */
export const makeAddressesOutput = (contractOfKey: Map<string, NodeContract>): AddressesOutput =>
  (expr: string, onUnknown: (field: string) => void): boolean => {
    const segments = expr.split(".");
    if (segments.length < 2) return false;
    const [nodeKey, second, ...rest] = segments;
    const contract = contractOfKey.get(nodeKey);
    if (!contract) return false; // refs to unknown nodes caught by ref checks below
    if (second !== "output") return true; // small structured data lives under output
    if (contract.fields == null) return true;
    const field = rest[0]?.replace(/\*.*/, "");
    if (!field) return true;
    if (!contract.fields.includes(field)) {
      onUnknown(field);
      return false;
    }
    return true;
  };

/**
 * The inherited input contract of one node: its upstream next-edge parents'
 * merged published fields (null when any parent is free-form — any field
 * passes), overlaid with the node's own non-empty `input_map` field names
 * (the same emptiness rule the runtime's evalInputMap applies: only
 * non-empty string mappings produce a field).
 */
export const inheritedInputFields = (
  edges: LintEdge[],
  n: LintNode,
  contractOfKey: Map<string, NodeContract>,
): string[] | null => {
  const parentKeys = edges.filter((e) => e.kind === "next" && e.to === n.key).map((e) => e.from);
  const parentContracts = parentKeys.map((k) => contractOfKey.get(k));
  let inheritedFields: string[] | null = !parentContracts.length
    ? null
    : parentContracts.some((c) => !c || c.fields == null)
      ? null
      : Array.from(
          new Set(
            parentContracts.flatMap((c) => (c?.fields != null ? c.fields : [])),
          ),
        );
  // the node's input_map overlays the inherited merge at run time
  // (evalInputMap) — its field names join the effective input contract,
  // so `{{input.<mapped>}}` refs lint against them too.
  const mapped = Object.entries(n.inputMap ?? {})
    .filter(([, v]) => typeof v === "string" && (v as string).trim())
    .map(([k]) => k)
    .filter((k) => k.trim());
  if (inheritedFields != null && mapped.length) {
    inheritedFields = Array.from(new Set([...inheritedFields, ...mapped]));
  }
  return inheritedFields;
};
