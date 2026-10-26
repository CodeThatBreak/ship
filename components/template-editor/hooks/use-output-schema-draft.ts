"use client";
/**
 * The TS-lite output-schema box's draft state (Phase 2), extracted from
 * ConfigFieldRow.tsx: the raw authoring text and the compiled `output_schema`
 * it produces. The compile runs on every text change and flows to the caller
 * through `onChange` — TS-lite members win; a valid JSON Schema object is
 * accepted as-is; anything else keeps the last good schema and surfaces the
 * error instead.
 */
import { useEffect, useState } from "react";
import { parseOutputContract } from "../ts-schema-lite";

interface UseOutputSchemaDraftOptions {
  /** the compiled schema currently persisted on the config */
  value: unknown;
  /** the catalog/class default — re-seeds the box when no override is set */
  defaultValue?: unknown;
  /** the previously persisted authoring text — seed source on mount */
  savedText?: string;
  /** the compiled schema (undefined = cleared) + the raw authoring text */
  onChange: (schema: unknown, saved: string | undefined) => void;
}

export function useOutputSchemaDraft({
  value,
  defaultValue,
  savedText,
  onChange,
}: UseOutputSchemaDraftOptions) {
  const effective = value !== undefined ? value : (defaultValue ?? null);
  const [text, setText] = useState<string>(() =>
    typeof savedText === "string" && savedText.trim()
      ? savedText
      : effective
        ? JSON.stringify(effective, null, 2)
        : "",
  );
  const [err, setErr] = useState<string | null>(null);

  // TS-lite parse wins (bare members); a valid JSON Schema object pasted in
  // is accepted as-is; anything else keeps the last good schema. The deps
  // are text-only on purpose (unchanged from TsOutputEditor): the compile
  // keys off the authoring text, not the (unstable) onChange identity.
  useEffect(() => {
    const src = text.trim();
    if (!src) {
      setErr(null);
      onChange(undefined, undefined);
      return;
    }
    const lite = parseOutputContract(src);
    if (!lite.error && lite.schema) {
      setErr(null);
      onChange(lite.schema, text);
      return;
    }
    try {
      const json = JSON.parse(src);
      if (json && typeof json === "object" && !Array.isArray(json)) {
        setErr(null);
        onChange(json, text);
        return;
      }
    } catch {
      /* fall through to the TS-lite error */
    }
    setErr(lite.error ?? "declares no fields");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return { text, setText, err };
}
