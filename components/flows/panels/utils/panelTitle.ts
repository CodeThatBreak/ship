import type { Node } from "@/types/flow";

/** The panel header title: the node contract's panel title wins, then the
 *  template label override, the template's own display name, the instance key. */
export function panelTitle(node: Node): string {
  return node.capabilities?.panelTitle ?? node.label ?? node.templateName ?? node.nodeKey;
}
