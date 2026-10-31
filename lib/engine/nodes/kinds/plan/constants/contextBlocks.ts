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
    scopedDefault: true,
    wholeDefault: true,
  },
  {
    id: 'contract',
    label: 'Branch contract',
    description:
      "Scope, files and dependencies of the branch being refined — locked: removing it would let the agent silently change the branch's scope",
    scopedDefault: true,
    wholeDefault: false,
    pinned: true,
  },
  {
    id: 'current',
    label: 'Current sub-plan',
    description:
      "This branch's current sub-plan prompt + live checklist rows — your hand edits are included and the refine preserves them",
    scopedDefault: true,
    wholeDefault: false,
  },
  {
    id: 'branches',
    label: 'Other branches',
    description: 'Sibling branches as title + scope summaries only',
    scopedDefault: false,
    wholeDefault: true,
  },
  {
    id: 'versions',
    label: 'Plan versions',
    description: 'Earlier full plan versions (~3k chars each — large; watch the char count)',
    scopedDefault: false,
    wholeDefault: false,
  },
  {
    id: 'edits',
    label: 'Hand edits',
    description:
      'Your live checklist edits across all branches, passed as intent the refine must respect (whole-plan refines only; scoped refines cover hand edits via Current sub-plan)',
    scopedDefault: false,
    wholeDefault: true,
  },
];

/** Fixed assembly order so prompts stay comparable across runs (§4). */
export const CONTEXT_BLOCK_ORDER: ContextBlockId[] = ['task', 'contract', 'current', 'branches', 'versions', 'edits'];
