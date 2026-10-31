import type { ModelChoice } from '@/types/modelSpec';

import { ACTION_TYPES } from '../constants/action';

type SetModelAction = {
  type: typeof ACTION_TYPES.SET_MODEL;
  payload: {
    model: ModelChoice | null;
  };
};

type ThreadChangedAction = {
  type: typeof ACTION_TYPES.THREAD_CHANGED;
  payload: {
    threadId: string;
  };
};

type DraftChangedAction = {
  type: typeof ACTION_TYPES.DRAFT_CHANGED;
  payload: {
    draft: string;
  };
};

type ResetAction = {
  type: typeof ACTION_TYPES.RESET;
};

export type ChatAction =
  | SetModelAction
  | ThreadChangedAction
  | DraftChangedAction
  | ResetAction;
