import { ACTION_TYPES } from '../constants/action';

import type { PlanUiAction, PlanUiState } from '../types/planTypes';

export const INITIAL_PLAN_UI: PlanUiState = { selectedId: null };

export function reducer(state: PlanUiState, action: PlanUiAction): PlanUiState {
  switch (action.type) {
    case ACTION_TYPES.SELECT_VERSION:
      return { ...state, selectedId: action.payload.id };
    default: {
      return state;
    }
  }
}
