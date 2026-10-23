/** Shared draft types for the template editor + node configurator. */
export interface EditorNode {
  /** instance key — unique in the template */
  key: string;
  /** the node_templates row backing this instance */
  nodeTemplateId: string;
  label: string;
  overrideLabel?: string | null;
  trigger: { type: string; minutes?: number; wait_for?: string };
  join_mode: string;
  config: Record<string, unknown>;
  input_map: Record<string, unknown>;
  kind: string | null;
  icon: string | null;
  catalog_name: string | null;
  is_builtin: boolean;
  description?: string | null;
}

export interface EditorEdge {
  from: string;
  to: string;
  kind: string;
  label: string | null;
  condition: string | null;
}

/** A /api/contracts response. */
export interface NodeContract {
  key: string;
  label: string;
  kind: string;
  input: any;
  output: any;
  config: {
    fields?: { key: string; label: string; type: string; help?: string; options?: { value: string; label: string }[] }[];
    defaults?: Record<string, unknown>;
  };
}

export function describeTrigger(t: { type: string; minutes?: number; wait_for?: string }): string {
  const bits: string[] = [t.type];
  if (t.type === "debounced" && t.minutes != null) bits.push(`${t.minutes} min`);
  if (t.wait_for) bits.push(`waits ${t.wait_for}`);
  return bits.join(" · ");
}
