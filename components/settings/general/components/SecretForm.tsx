"use client";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SECRET_MASK, SECRET_PLACEHOLDER, SECRETS_USAGE } from "../constants";
import type { SecretFormState } from "../types";

/** The add/edit secret body: name + write-only value. The value hint changes
 *  with the mode — blank on edit keeps the stored value (the server never
 *  hands values back, so a rename needs it retyped). */
export function SecretForm({ state, editingName, setField }: {
  state: SecretFormState;
  /** stored secret name while editing; null while adding */
  editingName: string | null;
  setField: <K extends keyof SecretFormState>(key: K, value: SecretFormState[K]) => void;
}) {
  return (
    <>
      <Field>
        <FieldLabel htmlFor="secret-name">Name</FieldLabel>
        <FieldDescription>
          Referenced as <code className="font-mono">{SECRETS_USAGE}</code> in http node
          URLs / headers / bodies.
        </FieldDescription>
        <Input
          id="secret-name"
          placeholder={SECRET_PLACEHOLDER.NAME}
          className="font-mono text-[12px]"
          autoComplete="off"
          value={state.name}
          onChange={(e) => setField("name", e.target.value)}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="secret-value">Value</FieldLabel>
        <FieldContent>
          <FieldDescription>
            {editingName === null
              ? "Resolves at execution time only — never written into flow rows, run inputs or events."
              : `Leave blank to keep the stored value (${SECRET_MASK}). A rename requires the value.`}
          </FieldDescription>
        </FieldContent>
        <Input
          id="secret-value"
          type="password"
          placeholder={SECRET_MASK}
          className="font-mono text-[12px]"
          value={state.value}
          onChange={(e) => setField("value", e.target.value)}
        />
      </Field>
    </>
  );
}
