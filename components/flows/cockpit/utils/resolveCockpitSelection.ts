/** Cockpit graph selection: follow `current_node` until the user picks a node. */
export const resolveCockpitSelectedKey = (
  selected: string,
  currentNode: string | null | undefined,
): string => selected || currentNode || "";
