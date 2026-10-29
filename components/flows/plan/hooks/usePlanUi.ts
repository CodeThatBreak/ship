import { useCallback, useReducer } from "react";
import type { Artifact } from "@/types/flow";
import { PLAN_UI_ACTION } from "../constants";
import type { PlanUiAction, PlanUiState } from "../types";

/** The plan-view's initial UI state: nothing selected, no branch expanded. */
const INITIAL_PLAN_UI: PlanUiState = { selectedId: null, expandedBranch: null };

/**
 * The plan-view's UI reducer: `{ type, payload }` actions over the selected
 * plan version and the expanded sub-plan branch. Pure and local — async data
 * stays in TanStack Query, the executing pick in `useExecutionPick`.
 */
function planUiReducer(state: PlanUiState, action: PlanUiAction): PlanUiState {
  switch (action.type) {
    case PLAN_UI_ACTION.SELECT_VERSION:
      return { ...state, selectedId: action.payload.id };
    case PLAN_UI_ACTION.TOGGLE_BRANCH:
      return {
        ...state,
        expandedBranch: state.expandedBranch === action.payload.name ? null : action.payload.name,
      };
    case PLAN_UI_ACTION.COLLAPSE_BRANCH:
      return { ...state, expandedBranch: null };
    default: {
      // exhaustiveness: an unhandled PlanUiAction member is a type error here
      void (action satisfies never);
      return state;
    }
  }
}

/**
 * The plan-view's stateful bits: the selected plan version and the expanded
 * sub-plan branch, reduced from typed `{ type, payload }` actions and exposed
 * as resolved state + named event callbacks. The hook resolves the selection
 * against the plan versions itself — later versions win when nothing (yet)
 * matches `selectedId`.
 */
export function usePlanUi(plans: Artifact[]) {
  const [state, dispatch] = useReducer(planUiReducer, INITIAL_PLAN_UI);
  const current = plans.find(a => a.id === state.selectedId) ?? plans[plans.length - 1] ?? null;

  const selectVersion = useCallback(
    (id: string) => dispatch({ type: PLAN_UI_ACTION.SELECT_VERSION, payload: { id } }),
    [],
  );
  const toggleBranch = useCallback(
    (name: string) => dispatch({ type: PLAN_UI_ACTION.TOGGLE_BRANCH, payload: { name } }),
    [],
  );
  const collapseBranch = useCallback(
    () => dispatch({ type: PLAN_UI_ACTION.COLLAPSE_BRANCH }),
    [],
  );
  return { current, expandedBranch: state.expandedBranch, selectVersion, toggleBranch, collapseBranch };
}
