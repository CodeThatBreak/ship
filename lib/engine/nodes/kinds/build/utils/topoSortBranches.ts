import "server-only";

import type { PlanBranch } from "../../plan/schema";

/** Topologically sort plan branches by `dependsOn`. Simple DFS — safe for
 *  small N. (Pure helper moved out of the BuildNode class file — engine
 *  overhaul §12: class files are pure.) */
export const topoSortBranches = (branches: PlanBranch[]): PlanBranch[] => {
  const byName = new Map(branches.map((b) => [b.name, b]));
  const visited = new Set<string>();
  const result: PlanBranch[] = [];
  const visit = (name: string): void => {
    if (visited.has(name)) return;
    visited.add(name);
    const b = byName.get(name);
    if (!b) return;
    for (const dep of b.dependsOn ?? []) visit(dep);
    result.push(b);
  };
  for (const b of branches) visit(b.name);
  return result;
};
