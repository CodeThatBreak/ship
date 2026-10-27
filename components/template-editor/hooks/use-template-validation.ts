"use client";
/**
 * Live template validation (Phase 3 + 5): the draft validates against the
 * static linter (debounced) while it's edited — the structured problems land
 * where they belong: per-node refs underline in the prompt editor, and the
 * structured coordinates render as canvas badges on the offending node /
 * edge chip. Read-only built-ins never validate (nothing is editable).
 */
import { useCallback, useState, useEffect } from "react";
import type { LintProblem } from "@/types/template-lint";
import { collectPendingDefs, type Draft } from "../draft";

/** Debounce window for live validation while editing. */
const VALIDATE_DEBOUNCE_MS = 600;

/** Where the problems are shown (refs underlined in prompts, badges on the
 *  canvas nodes, rose edge chips). */
interface ValidationProblems {
  refs: Record<string, Record<string, string>>;
  nodeMap: Record<string, string[]>;
  edgeMap: Record<number, string>;
}

const EMPTY: ValidationProblems = { refs: {}, nodeMap: {}, edgeMap: {} };

/** The problems joined as the readable save-blocker message (the same
 *  joined string the server throws with). */
export function problemsMessage(problems: LintProblem[]): string {
  return problems
    .map((p) => (p.where ? `${p.where}: ${p.message}` : p.message))
    .join("\n");
}

export interface TemplateValidationApi {
  nodeProblems: Record<string, string[]>;
  edgeProblems: Record<number, string>;
  invalidRefs: Record<string, Record<string, string>>;
  /** POST the draft to the validate endpoint — returns the structured
   *  problems for the save gate (they're already applied to the state). */
  validate: (draft: Draft) => Promise<LintProblem[]>;
  clear: () => void;
}

/** The POST body's node slice (the server re-lints from this shape). */
function lintNode(n: Draft["nodes"][number]) {
  return {
    key: n.key,
    nodeTemplateId: n.nodeTemplateId,
    config: n.config,
    input_map: n.input_map,
  };
}

/** The POST body's edge slice. */
function lintEdge(e: Draft["edges"][number]) {
  return {
    from: e.from,
    to: e.to,
    kind: e.kind,
    label: e.label,
    condition: e.condition,
  };
}

/** The debounced live validation over the draft; read-only built-ins and
 *  missing drafts skip (nothing editable). */
export function useTemplateValidation(
  draft: Draft | null,
): TemplateValidationApi {
  const [problems, setProblems] = useState<ValidationProblems>(EMPTY);

  /** The validate problems → where they're shown. */
  const applyProblems = useCallback((next: LintProblem[]) => {
    const refs: Record<string, Record<string, string>> = {};
    const nodeMap: Record<string, string[]> = {};
    const edgeMap: Record<number, string> = {};
    for (const p of next) {
      if (p.nodeKey) (nodeMap[p.nodeKey] ??= []).push(p.message);
      else if (typeof p.edgeIndex === "number")
        edgeMap[p.edgeIndex] = p.message;
      if (p.ref && p.nodeKey) (refs[p.nodeKey] ??= {})[p.ref] = p.message;
    }
    setProblems({ refs, nodeMap, edgeMap });
  }, []);

  const validate = useCallback(
    async (d: Draft): Promise<LintProblem[]> => {
      const parsed = await fetch(
        `/api/templates/${d.template.id}/validate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trigger: d.template.trigger,
            nodes: d.nodes.map(lintNode),
            edges: d.edges.map(lintEdge),
            new_node_templates: collectPendingDefs(d),
          }),
        },
      )
        .then((r) => r.json() as Promise<{ problems?: LintProblem[] } | null>)
        .catch(() => null);
      const next = parsed?.problems ?? [];
      applyProblems(next);
      return next;
    },
    [applyProblems],
  );

  // debounced while edited
  useEffect(() => {
    if (!draft || draft.template.is_builtin) return;
    const timer = setTimeout(() => void validate(draft), VALIDATE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, validate]);

  const clear = useCallback(() => setProblems(EMPTY), []);

  return {
    nodeProblems: problems.nodeMap,
    edgeProblems: problems.edgeMap,
    invalidRefs: problems.refs,
    validate,
    clear,
  };
}
