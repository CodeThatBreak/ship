/**
 * Boilerplate definitions for new Template Nodes (§8): a working starter
 * config per declarative kind, so a node is never born blank — the author
 * places/creates it ready to run and only remaps its inputs or tweaks the
 * knobs. The keys are exactly what the runtime classes declare in their
 * `configFields` (the schema-driven forms edit the same shape), and the
 * server re-validates the config through the kind's zod schema at save time,
 * so unknown keys would never persist anyway.
 */

/** The authorable declarative kinds (TemplateStore's KINDED_NODE_TEMPLATE_KINDS). */
export type NodeTemplateKind = "agent" | "decision" | "http" | "script";

export const NODE_TEMPLATE_KINDS: NodeTemplateKind[] = ["agent", "decision", "http", "script"];

/** Boilerplate display description per kind (the create dialog / palette seed). */
export const NODE_KIND_DESCRIPTIONS: Record<NodeTemplateKind, string> = {
  agent: "Agent run — reusable from the Library once saved",
  decision: "Branch pick — reusable from the Library once saved",
  http: "HTTP request — reusable from the Library once saved",
  script: "Script run — reusable from the Library once saved",
};

/** A working starter definition per kind. Copy per node — never share
 *  references (the forms mutate their copies' arrays/objects in place). */
export const NODE_BOILERPLATE: Record<NodeTemplateKind, Record<string, unknown>> = {
  agent: {
    mode: "plan",
    prompt: [
      'You are working on task "{{task.key}} — {{task.summary}}".',
      "",
      "Task description:",
      "{{task.description}}",
      "",
      "Instructions:",
      "1. <what this agent should do — {{input.*}} carries the previous node's output>",
      "",
      "Return your result as markdown.",
    ].join("\n"),
    model: null,
    output: "markdown",
  },
  decision: {
    source: "manual",
    question: "",
    choices: [
      { label: "yes", description: "proceed" },
      { label: "no", description: "stop here" },
    ],
    pass: {},
  },
  http: {
    url: "https://api.example.com/v1/resource",
    method: "GET",
    headers: { Accept: "application/json" },
    body: null,
    timeout_ms: 30_000,
    response_map: null,
  },
  script: {
    runtime: "shell",
    script: [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "",
      "# stdin: the mapped input JSON — $DEVFLOW_INPUT holds it too",
      "",
      "echo 'todo'",
    ].join("\n"),
    cwd: "repo",
    timeout_ms: 120_000,
    env: [],
    output_schema: null,
  },
};

/** The kind's boilerplate as a fresh deep copy (an unknown kind → empty —
 *  the form still renders from the contract, the save validates the rest). */
export function boilerplateFor(kind: string): Record<string, unknown> {
  const seed = NODE_BOILERPLATE[kind as NodeTemplateKind];
  return seed ? (structuredClone(seed) as Record<string, unknown>) : {};
}
