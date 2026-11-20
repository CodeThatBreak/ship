/** Authoring errors surfaced by target resolution and the compatibility
 *  check — loud, like a contract failure (the plan's stated policy). */
export class SplitTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SplitTargetError";
  }
}
