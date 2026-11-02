"use client";
import { useMemo, useReducer } from "react";

/**
 * Stepper form state for a connect modal: pick a provider → pick hosting
 * (cloud / self-hosted) → fill fields. One reducer replaces the previous
 * pile of independent useStates, and "picking a provider restarts the
 * stepper" is encoded once instead of scattered across every onChange.
 */

export type ConnectFormState = {
  /** chosen provider kind ("" until a provider is picked) */
  provider: string;
  /** cloud vs self-hosted ("" until chosen; some providers skip this step) */
  hosting: string;
  /** field values by name (name, baseUrl, email, token, apiKey…) */
  fields: Record<string, string>;
};

export const EMPTY_CONNECT_FORM: ConnectFormState = {
  provider: "",
  hosting: "",
  fields: {},
};

export type ConnectFormAction =
  | { type: "provider"; provider: string }
  | { type: "hosting"; hosting: string }
  | { type: "field"; field: string; value: string }
  | { type: "reset" };

function connectFormReducer(state: ConnectFormState, action: ConnectFormAction): ConnectFormState {
  switch (action.type) {
    case "provider":
      // a different provider restarts the stepper
      return { provider: action.provider, hosting: "", fields: {} };
    case "hosting":
      return { ...state, hosting: action.hosting };
    case "field":
      return { ...state, fields: { ...state.fields, [action.field]: action.value } };
    case "reset":
      return EMPTY_CONNECT_FORM;
  }
}

/** Action callbacks are wrapped in useMemo so they stay referentially stable. */
export function useConnectForm() {
  const [state, dispatch] = useReducer(connectFormReducer, EMPTY_CONNECT_FORM);
  const actions = useMemo(
    () => ({
      setProvider: (provider: string) => dispatch({ type: "provider", provider }),
      setHosting: (hosting: string) => dispatch({ type: "hosting", hosting }),
      setField: (field: string, value: string) => dispatch({ type: "field", field, value }),
      reset: () => dispatch({ type: "reset" }),
    }),
    [],
  );
  return useMemo(() => ({ state, ...actions }), [state, actions]);
}
