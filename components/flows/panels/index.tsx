'use client';
/**
 * The panels' feature barrel: the workspace factory is the resolution entry
 * (explicit tables ex-§3.1's registry), and the panels' no-prop contract
 * hangs off the NodePanelContext. The factory imports every panel eagerly,
 * so resolving a node needs only this module.
 */
export { resolveNodePanel, type NodeWorkspace } from './panel-factory';
export { useNodePanel, NodePanelContext } from './context';
export type { NodePanelContextValue, ActionPayload } from './context';
export { useNodeChatBindings } from './hooks/useNodeChatBindings';
