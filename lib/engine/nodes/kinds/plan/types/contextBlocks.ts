// ── context block registry (§4) ──────────────────────────────────────────────

export type ContextBlockId = 'task' | 'contract' | 'current' | 'branches' | 'versions' | 'edits';

export interface ContextBlockSpec {
  id: ContextBlockId;
  label: string;
  description: string;
  /** default-on for scoped (branch) refines */
  scopedDefault: boolean;
  /** default-on for whole-plan refines */
  wholeDefault: boolean;
  /** the engine always includes this block — the UI shows it locked */
  pinned?: boolean;
}

/** A resolved context block, as reported to the prompt route / picker. */
export interface ContextBlockInfo {
  id: ContextBlockId;
  label: string;
  description: string;
  /** rendered preview (what the model would see for this block) */
  text: string;
  chars: number;
  defaultOn: boolean;
  locked: boolean;
}
