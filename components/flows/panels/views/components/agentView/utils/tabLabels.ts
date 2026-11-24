/** Tab label for an artifact-backed tab (e.g. `failed_output` → "Failed output"). */
export const kindTabLabel = (kind: string): string =>
  kind.replaceAll('_', ' ').replace(/^./, char => char.toUpperCase());

/** The agent panel numbers its output versions as runs, not `v1`/`v2`. */
export const runVersionLabel = (version: number): string => `Run ${version}`;
