/**
 * The shared variable vocabulary (Phase 3): one shape for every picker
 * surface — the prompt editor's "@" popover, the per-field "Variables ▾"
 * pickers, and the later phases' condition builder / mapping picker.
 *
 * A group is a titled cluster of insertable fields:
 *
 *   • inputs   — this node's effective run input, `{{input.<field>}}`
 *                ("My inputs": the inherited parent merge overlaid with the
 *                node's `input_map` mappings — logical: re-mapping a field's
 *                source never breaks a prompt that addresses it)
 *   • task     — the template's task context, `{{task.<key>}}` (no wiring)
 *   • upstream — one group per connected upstream node's published outputs,
 *                `{{nodes.<key>.output.<field>}}` (physical: keyed on the
 *                instance slug)
 *   • trigger  — the flow's start payload, `{{trigger.payload.<field>}}`
 *
 * The popover renders headers per group and only for non-empty groups;
 * search filters the fields flat across groups.
 */

export type VarGroupId =
  | "inputs"
  | "task"
  | "upstream"
  | "trigger"
  | "http-secrets";

export interface VarField {
  name: string;
  type?: string;
  description?: string;
  /** the raw ref inserted into the field — `{{input.summary}}`, … */
  insert: string;
}

export interface VarGroup {
  id: VarGroupId;
  /** "Inherited" / "Task" / "Upstream: Review" / "Trigger payload" */
  title: string;
  /** "merged from Review" / "the flow's task" / … — shown beside the title */
  origin?: string;
  fields: VarField[];
}

/** One connected upstream node's pickable output fields (resolved contracts). */
export interface UpstreamVarSource {
  /** the instance key the `{{nodes.<key>.output.*}}` refs address */
  key: string;
  label: string;
  fields: { name: string; type?: string }[];
}

/**
 * The connected parents' published fields merged by name — the same merge the
 * engine's implicit inheritance does (`inheritedInput`: every `next`-edge
 * parent's output merged, last wins). `from` lists every parent publishing
 * the field; two entries is the silent-collision case the Inputs tab badges.
 */
export function mergeUpstreamFields(
  upstream: UpstreamVarSource[],
): { name: string; type?: string; from: string[] }[] {
  const byName = new Map<string, { type?: string; from: string[] }>();
  for (const src of upstream) {
    for (const f of src.fields) {
      const hit = byName.get(f.name);
      if (hit) {
        if (!hit.from.includes(src.label)) hit.from.push(src.label);
      } else {
        byName.set(f.name, { type: f.type, from: [src.label] });
      }
    }
  }
  return [...byName.entries()].map(([name, f]) => ({
    name,
    type: f.type,
    from: f.from,
  }));
}

/** The `flow.*` / `repo.*` context fields — the two fixed two-key roots of
 *  the context universe that no contract declares. The Inputs tab's mapping
 *  source picker offers them as their own group. */
export const FLOW_REPO_FIELDS: { path: string; label: string; type: string }[] = [
  { path: "flow.mr_url", label: "MR url", type: "string" },
  { path: "flow.mr_branch", label: "MR branch", type: "string" },
  { path: "repo.cloud_url", label: "Repo cloud url", type: "string" },
  { path: "repo.local_path", label: "Repo local path", type: "string" },
];

/**
 * Resolves a known-shape JSONata mapping expression to a friendly source
 * description (`nodes.build.output.plan` → "Build · output.plan") and the
 * source field's declared type. Known shapes: `nodes.<key>.output.<field>`,
 * `task.<field>`, `trigger.payload.<field>`, `flow.*` / `repo.*`. Anything
 * else (arbitrary JSONata) resolves to null — the caller shows the raw
 * expression as a custom mapping.
 */
export function resolveMapExpr(
  expr: string,
  opts: {
    upstream?: UpstreamVarSource[];
    taskFields?: { key: string; label?: string; type?: string }[];
    triggerFields?: { key: string; label?: string; type?: string }[];
  } = {},
): { source: string; type?: string } | null {
  const s = expr.trim();
  let m = /^nodes\.([A-Za-z0-9_]+)\.output\.(.+)$/.exec(s);
  if (m) {
    const src = opts.upstream?.find((u) => u.key === m![1]);
    const field = m![2];
    const f = src?.fields.find((x) => x.name === field);
    return {
      source: src ? `${src.label} · output.${field}` : s,
      type: f?.type,
    };
  }
  m = /^task\.([A-Za-z0-9_]+)$/.exec(s);
  if (m) {
    const f = opts.taskFields?.find((x) => x.key === m![1]);
    return { source: `Task · ${m![1]}`, type: f?.type };
  }
  m = /^trigger\.payload\.([A-Za-z0-9_.]+)$/.exec(s);
  if (m) {
    const f = opts.triggerFields?.find((x) => x.key === m![1]);
    return { source: `Trigger payload · ${m![1]}`, type: f?.type };
  }
  m = /^(flow|repo)\.([A-Za-z0-9_]+)$/.exec(s);
  if (m) {
    return { source: `${m[1] === "flow" ? "Flow" : "Repo"} · ${m![2]}` };
  }
  return null;
}

/**
 * Assembles the full popover vocabulary. Order follows the mental model:
 * my inputs → task context → upstream nodes → trigger payload.
 */
export function buildVarGroups(opts: {
  taskFields?: { key: string; label?: string; type?: string }[];
  triggerFields?: { key: string; label?: string; type?: string }[];
  upstream?: UpstreamVarSource[];
  /** this node's `input_map` (Phase 4): `{field: "<JSONata>"}` mappings the
   *  engine overlays on the inherited merge at run time — "My inputs" shows
   *  the effective input, each mapped field's origin annotated in its
   *  description ("mapped: Build · output.plan"). */
  inputMap?: Record<string, unknown>;
}): VarGroup[] {
  const groups: VarGroup[] = [];

  // inputs — the parents' merged published fields, addressed logically, with
  // the node's input_map mappings overlaid (mapped fields win at run time,
  // so they win here too)
  const upstream = opts.upstream ?? [];
  const inherited = mergeUpstreamFields(upstream);
  const mapEntries = Object.entries(opts.inputMap ?? {}).filter(
    ([, v]) => typeof v === "string" && (v as string).trim(),
  ) as [string, string][];
  if (inherited.length || mapEntries.length) {
    const originOf = new Map<string, string>();
    for (const [field, expr] of mapEntries) {
      const res = resolveMapExpr(expr, {
        upstream,
        taskFields: opts.taskFields,
        triggerFields: opts.triggerFields,
      });
      originOf.set(field, res?.source ?? expr);
    }
    const fields: VarField[] = inherited
      .filter((f) => !originOf.has(f.name))
      .map((f) => ({
        name: f.name,
        type: f.type,
        description:
          f.from.length > 1 ? `inherited from ${f.from.join(" + ")}` : undefined,
        insert: `{{input.${f.name}}}`,
      }));
    for (const [field, source] of originOf) {
      fields.push({
        name: field,
        type: resolveMapExpr(
          mapEntries.find(([k]) => k === field)?.[1] ?? "",
          { upstream, taskFields: opts.taskFields, triggerFields: opts.triggerFields },
        )?.type,
        description: `mapped: ${source}`,
        insert: `{{input.${field}}}`,
      });
    }
    const origin = [
      upstream.length
        ? `merged from ${upstream.map((s) => s.label).join(" + ")}`
        : null,
      mapEntries.length ? `${mapEntries.length} mapped` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    groups.push({
      id: "inputs",
      title: "My inputs",
      origin: origin || undefined,
      fields,
    });
  }

  // task — the flow's task context, available to every node with no wiring
  const taskFields = opts.taskFields ?? [];
  if (taskFields.length) {
    groups.push({
      id: "task",
      title: "Task",
      origin: "the flow's task — no wiring needed",
      fields: taskFields.map((f) => ({
        name: f.key,
        type: f.type,
        description: f.label && f.label !== f.key ? f.label : undefined,
        insert: `{{task.${f.key}}}`,
      })),
    });
  }

  // upstream — one header per node, its contract's typed fields
  for (const src of upstream) {
    if (!src.fields.length) continue;
    groups.push({
      id: "upstream",
      title: `Upstream: ${src.label}`,
      origin: src.key !== src.label ? src.key : undefined,
      fields: src.fields.map((f) => ({
        name: f.name,
        type: f.type,
        insert: `{{nodes.${src.key}.output.${f.name}}}`,
      })),
    });
  }

  // trigger — the flow's start payload (the start node's contract fields)
  const triggerFields = opts.triggerFields ?? [];
  if (triggerFields.length) {
    groups.push({
      id: "trigger",
      title: "Trigger payload",
      origin: "what starts the flow",
      fields: triggerFields.map((f) => ({
        name: f.key,
        type: f.type,
        description: f.label && f.label !== f.key ? f.label : undefined,
        insert: `{{trigger.payload.${f.key}}}`,
      })),
    });
  }

  return groups;
}

/**
 * Search across the vocabulary: fields match flat (name, description or
 * group title), while the group structure survives — headers render only
 * when the group has a matching field.
 */
export function filterVarGroups(groups: VarGroup[], query: string): VarGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups.filter((g) => g.fields.length > 0);
  return groups
    .map((g) => ({
      ...g,
      fields: g.fields.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          (f.description ?? "").toLowerCase().includes(q) ||
          g.title.toLowerCase().includes(q),
      ),
    }))
    .filter((g) => g.fields.length > 0);
}

/** Groups' fields as raw JSONata paths — for the expression boxes (the
 *  `{{...}}` wrapper is prompt syntax, not JSONata). */
export function asJsonataGroups(groups: VarGroup[]): VarGroup[] {
  return groups.map((g) => ({
    ...g,
    fields: g.fields.map((f) => ({ ...f, insert: stripBraces(f.insert) })),
  }));
}

/** One pickable path in the expression boxes' autocomplete (Phase 5 Tier 2). */
export interface JsonataPathOption {
  /** the raw path inserted — `nodes.build.output.plan` */
  path: string;
  /** the group it came from ("Upstream: Build" / "Task") */
  group: string;
  type?: string;
  description?: string;
}

/**
 * The grouped vocabulary → the flat autocomplete list the expression boxes
 * (ConditionBuilder / ExpressionInput) offer as you type.
 */
export function jsonataPathOptions(groups: VarGroup[]): JsonataPathOption[] {
  return asJsonataGroups(groups).flatMap((g) =>
    g.fields.map((f) => ({
      path: f.insert,
      group: g.title,
      type: f.type,
      description: f.description,
    })),
  );
}

/**
 * The http `response_map` vocabulary — that expression evaluates against the
 * raw response object (`{status, ok, body, headers}`), not the flow context.
 */
export function httpResponseVarGroups(): VarGroup[] {
  return [
    {
      id: "upstream",
      title: "Response",
      origin: "the raw HTTP response",
      fields: [
        { name: "status", type: "number", insert: "status" },
        { name: "ok", type: "boolean", insert: "ok" },
        { name: "body", type: "object", insert: "body" },
        { name: "headers", type: "object", insert: "headers" },
      ],
    },
  ];
}

/**
 * The flow/repo roots as a vocabulary group — conditions and pass-map
 * expressions evaluate against the whole flow context (not a node's input),
 * so `flow.*` / `repo.*` are addressable and offered beside the task/upstream
 * groups. Note the "My inputs" group does NOT apply there (the context map
 * has no `input` root — that's a per-node runtime concept).
 */
export function flowRepoVarGroups(): VarGroup[] {
  return [
    {
      id: "trigger",
      title: "Flow & repo",
      origin: "the run's flow context",
      fields: FLOW_REPO_FIELDS.map((f) => ({
        name: f.path,
        type: f.type,
        insert: `{{${f.path}}}`,
      })),
    },
  ];
}

/**
 * The condition/pass vocabulary for a node's expression editors (Phase 5):
 * the node's groups minus "My inputs" (the flow context map has no `input`
 * root — conditions see task / upstream / trigger / flow / repo), plus the
 * flow & repo group.
 */
export function conditionVarGroups(groups: VarGroup[]): VarGroup[] {
  return [...groups.filter((g) => g.id !== "inputs"), ...flowRepoVarGroups()];
}

export function stripBraces(ref: string): string {
  return ref.replace(/^\{\{/, "").replace(/\}\}$/, "");
}

/**
 * Color coding of the inline refs (Phase 3): `{{input.*}}` blue (logical —
 * survives re-mapping), `{{nodes.*}}` violet (physical — wiring-dependent),
 * other roots neutral. Takes the inner ref (no braces).
 */
export function refColorClass(ref: string): string {
  const root = ref.trim().split(".")[0];
  if (root === "input") return "prompt-var-input";
  if (root === "nodes") return "prompt-var-nodes";
  return "prompt-var-other";
}

/** The popover's accent for a group's refs — matches the inline color coding. */
export function varGroupAccent(id: VarGroupId): string {
  switch (id) {
    case "inputs":
      return "text-blue-400";
    case "upstream":
      return "text-violet-400";
    default:
      return "text-muted-foreground";
  }
}

/**
 * A JSON-Schema object → its object rows (the contract tables and the
 * trigger-payload vocabulary). Non-object schemas list nothing.
 */
export function schemaRows(
  schema: any,
): { name: string; type: string; required: boolean; description?: string }[] {
  if (!schema || schema.type !== "object" || !schema.properties) return [];
  const required: string[] = schema.required ?? [];
  return Object.entries(schema.properties as Record<string, any>).map(
    ([name, s]) => ({
      name,
      type: Array.isArray(s?.type)
        ? s.type.join("|")
        : (s?.type ?? (s?.enum ? "enum" : "any")),
      required: required.includes(name),
      description: typeof s?.description === "string" ? s.description : undefined,
    }),
  );
}
