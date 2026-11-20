import "server-only";

/** A cycle in the declared unit dependencies — a producer error, loud like a
 *  contract failure. `path` is the closed walk, e.g. ["a", "b", "a"]. */
export class UnitCycleError extends Error {
  /** the cycle path, first and last element the same unit key */
  readonly path: string[];

  constructor(path: string[]) {
    super(`unit dependency cycle: ${path.join(" → ")}`);
    this.name = "UnitCycleError";
    this.path = path;
  }
}
