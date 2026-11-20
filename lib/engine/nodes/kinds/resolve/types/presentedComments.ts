import "server-only";

/** What `ResolveOutputContract.presentComments` renders for the run prompt:
 *  the `{{comments}}` lines plus the exact coverage set the parse step must
 *  validate against (block truncation can drop lines — the ids follow). */
export type PresentedComments = {
  /** deterministic, id-tagged lines for the `{{comments}}` slot */
  text: string;
  /** the ids actually presented — the parse coverage set */
  ids: string[];
  /** loud-cap messages naming every truncation applied while presenting
   *  (empty = nothing was capped) — the node turns them into one `log` event */
  truncations: string[];
};
