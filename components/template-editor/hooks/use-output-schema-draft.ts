"use client";
import { useCallback, useState } from "react";
import { parseOutputContract } from "../ts-schema-lite";

export const parseOutputSchemaText = (
  text: string,
): { schema?: unknown; saved?: string; err?: string } => {
  const src = text.trim();
  if (!src) return { schema: undefined, saved: undefined };
  const lite = parseOutputContract(src);
  if (!lite.error && lite.schema) {
    return { schema: lite.schema, saved: text };
  }
  try {
    const json = JSON.parse(src);
    if (json && typeof json === "object" && !Array.isArray(json)) {
      return { schema: json, saved: text };
    }
  } catch {
    /* fall through */
  }
  return { err: lite.error ?? "declares no fields" };
};

interface UseOutputSchemaDraftOptions {
  value: unknown;
  defaultValue?: unknown;
  savedText?: string;
  onChange: (schema: unknown, saved: string | undefined) => void;
}

export const useOutputSchemaDraft = ({
  value,
  defaultValue,
  savedText,
  onChange,
}: UseOutputSchemaDraftOptions) => {
  const effective = value !== undefined ? value : (defaultValue ?? null);
  const [text, setTextState] = useState<string>(() =>
    typeof savedText === "string" && savedText.trim()
      ? savedText
      : effective
        ? JSON.stringify(effective, null, 2)
        : "",
  );
  const [err, setErr] = useState<string | null>(null);

  const setText = useCallback(
    (next: string) => {
      setTextState(next);
      const parsed = parseOutputSchemaText(next);
      if (parsed.err) {
        setErr(parsed.err);
        return;
      }
      setErr(null);
      onChange(parsed.schema, parsed.saved);
    },
    [onChange],
  );

  return { text, setText, err };
};
