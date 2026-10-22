import { PlanMeta } from "./schema";

/** Parses and validates the trailing ```json plan-meta``` block of a plan. */
export class PlanMetaParser {
  /** Extract and validate the plan-meta JSON from the trailing code block. */
  parse(text: string): PlanMeta | null {
    const m = text.match(/```json plan-meta\s*\n([\s\S]*?)```/);
    if (!m) return null;
    try {
      const raw = JSON.parse(m[1]);
      // branch names must be unique and dependsOn references must resolve
      if (Array.isArray(raw?.branches) && raw.branches.length) {
        const names = new Set<string>();
        for (const b of raw.branches) {
          if (!b?.name || names.has(b.name)) return null;
          names.add(b.name);
        }
        for (const b of raw.branches) {
          for (const dep of b.dependsOn ?? []) {
            if (!names.has(dep)) return null;
          }
        }
      }
      const parsed = PlanMeta.safeParse(raw);
      if (!parsed.success) return null;
      const out = parsed.data;
      // steps need stable unique ids
      if (out.steps?.length) {
        const ids = new Set<string>();
        out.steps = out.steps.map((s, i) => {
          const id = s.id?.trim() || `s${i + 1}`;
          return { ...s, id };
        });
        for (const s of out.steps) {
          if (ids.has(s.id!)) return null;
          ids.add(s.id!);
        }
      }
      return out.steps?.length || out.branches?.length ? out : null;
    } catch {
      return null;
    }
  }
}
