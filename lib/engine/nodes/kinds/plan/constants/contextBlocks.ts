import "server-only";

import type { ContextBlockSpec, ContextBlockId } from '../types/contextBlocks';

/**
 * The picker data + assembly registry. Defaults are the minimal-context
 * recommendation (§3): small context in → small output out. The picker's job is
 * to show what the model sees and allow EXPANSION, not to tempt users into
 * pruning.
 */
export const CONTEXT_BLOCKS: ContextBlockSpec[] = [
  {
    id: 'task',
    label: 'Task context',
    description: 'PRD, Figma links, acceptance criteria',
    wholeDefault: true,
  },
  {
    id: 'edits',
    label: 'Hand edits',
    description:
      'Your live checklist edits across the plan, passed as intent the refine must respect',
    wholeDefault: true,
  },
];

/** Fixed assembly order so prompts stay comparable across runs (§4). */
export const CONTEXT_BLOCK_ORDER: ContextBlockId[] = ['task', 'edits'];
