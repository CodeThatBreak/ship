/**
 * The shared variable vocabulary (Phase 3): one shape for every picker
 * surface — the prompt editor's "@" popover, the per-field "Variables ▾"
 * pickers, and the later phases' condition builder / mapping picker.
 *
 * A group is a titled cluster of insertable fields:
 *
 *   • inputs   — this node's inherited run input, `{{input.<field>}}`
 *                (logical: re-mapping a field's source never breaks a prompt
 *                that addresses it)
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
 * Assembles the full popover vocabulary. Order follows the mental model:
 * inherited input → task context → upstream nodes → trigger payload.
 */
export function buildVarGroups(opts: {
  taskFields?: { key: string; label?: string; type?: string }[];
  triggerFields?: { key: string; label?: string; type?: string }[];
  upstream?: UpstreamVarSource[];
}): VarGroup[] {
  const groups: VarGroup[] = [];

  // inputs — the parents' merged published fields, addressed logically
  const upstream = opts.upstream ?? [];
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
  if (byName.size) {
    groups.push({
      id: "inputs",
      title: "Inherited",
      origin: `merged from ${upstream.map((s) => s.label).join(" + ")}`,
      fields: [...byName.entries()].map(([name, f]) => ({
        name,
        type: f.type,
        description: f.from.length > 1 ? `inherited from ${f.from.join(" + ")}` : undefined,
        insert: `{{input.${name}}}`,
      })),
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
