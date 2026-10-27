"use client";
import { useCallback, useState } from "react";
import type { SecretFormState } from "../types";

export const EMPTY_SECRET_FORM: SecretFormState = { name: "", value: "" };

/** Map a stored secret name onto the editable form shape (value stays blank —
 *  stored values never leave the server; leaving it blank keeps the value). */
export function formFromSecret(name: string): SecretFormState {
  return { name, value: "" };
}

/**
 * Add/edit secret form state. `setField`, `replace` and `reset` are stable so
 * they flow into the modal without re-render churn (AGENTS.md §1.3).
 */
export function useSecretForm() {
  const [state, setState] = useState<SecretFormState>(EMPTY_SECRET_FORM);

  const setField = useCallback(
    <K extends keyof SecretFormState>(key: K, value: SecretFormState[K]) => {
      setState((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );
  const replace = useCallback((next: SecretFormState) => setState(next), []);
  const reset = useCallback(() => setState(EMPTY_SECRET_FORM), []);

  return { state, setField, replace, reset };
}
