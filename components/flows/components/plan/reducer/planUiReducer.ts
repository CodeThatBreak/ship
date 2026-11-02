import { ACTION_TYPES } from '../constants/action';

import type { PlanUiAction, PlanUiState } from '../types/planTypes';

export const INITIAL_PLAN_UI: PlanUiState = { selectedId: null, expandedBranch: null };

export function reducer(state: PlanUiState, action: PlanUiAction): PlanUiState {
  switch (action.type) {
    case ACTION_TYPES.SELECT_VERSION:
      return { ...state, selectedId: action.payload.id };
    case ACTION_TYPES.TOGGLE_BRANCH:
      return {
        ...state,
        expandedBranch: state.expandedBranch === action.payload.name ? null : action.payload.name,
      };
    case ACTION_TYPES.COLLAPSE_BRANCH:
      return { ...state, expandedBranch: null };
    default: {
      return state;
    }
  }
}
