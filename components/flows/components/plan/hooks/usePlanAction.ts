import { useReducer } from 'react';

import { ACTION_TYPES } from '../constants/action';

import { useFlowMutation } from '@/components/flows/mutations/useFlowMutation';

import type { Action } from '../types/action';

import { reducer, INITIAL_PLAN_UI } from '../reducer';

export function usePlanAction(flowId: string) {
  const flowMutation = useFlowMutation({ flowId });

  const [state, dispatch] = useReducer(reducer, INITIAL_PLAN_UI);

  const onAction = (action: Action) => {
    const { type } = action;

    switch (type) {
      case ACTION_TYPES.RETRY_AGENT:
      case ACTION_TYPES.CANCEL_AGENT:
      case ACTION_TYPES.APPROVE:
      case ACTION_TYPES.APPROVE:
      case ACTION_TYPES.SET_PLAN_STEP:
      case ACTION_TYPES.UPDATE_PLAN_STEPS: {
        flowMutation({ action: type, ...action.payload });
        break;
      }

      case ACTION_TYPES.SELECT_VERSION:
      case ACTION_TYPES.TOGGLE_BRANCH:
      case ACTION_TYPES.COLLAPSE_BRANCH: {
        dispatch(action);
        break;
      }

      default:
        return;
    }
  };

  return { state, onAction };
}
