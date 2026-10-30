import type { ModelChoice } from '@/types/model-spec';

import { ACTION_TYPES } from '../constants/action';

type SetModelAction = {
  type: typeof ACTION_TYPES.SET_MODEL;
  payload: {
    model: ModelChoice | null;
  };
};

type TabChangedAction = {
  type: typeof ACTION_TYPES.TAB_CHANGED;
  payload: {
    tabId: string;
  };
};

export type ChatAction = SetModelAction | TabChangedAction;
