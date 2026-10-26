"use client";
/**
 * The raw JSONata box (Tier 2 + 3): paths autocomplete from the vocabulary,
 * compile errors surface inline as you type (client-side lintJsonata), and
 * the expression's value renders underneath against the live preview context.
 */
import { useMemo, useRef, useState } from "react";
import { Textarea } from "../../ui/textarea";
import { lintJsonata } from "./jsonata-eval";
import {
  jsonataPathOptions,
  type VarGroup,
} from "../variables";
import { LINT_DEBOUNCE_MS } from "./constants";
import { PathPopover, tokenBefore } from "./PathAutocomplete";
import { PreviewLine } from "./PreviewLine";
import { useDebouncedValue } from "./use-debounced-value";
import { useExpressionPreview } from "./use-expression-preview";
import type { PreviewScope } from "./types";

export function ExpressionInput({
  value,
  onChange,
  varGroups,
  templateId,
  scope = "context",
  placeholder,
  rows = 2,
  disabled,
  autoFocus,
  align = "left",
}: {
  value: string;
  /** JSONata-stripped groups (asJsonataGroups) — the autocomplete vocabulary */
  varGroups?: VarGroup[];
  /** enables the live preview (no template → no context to evaluate against) */
  templateId?: string;
  scope?: PreviewScope;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  /** focus the box on mount (the Inputs tab's custom-expression field) */
  autoFocus?: boolean;
  /** the autocomplete panel's anchor edge (see PathPopover) */
  align?: "left" | "right";
  onChange: (v: string) => void;
}) {
  const options = useMemo(
    () => jsonataPathOptions(varGroups ?? []),
    [varGroups],
  );
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // live compile feedback (pure JS — no round trip): derived from the
  // debounced text, not stored (a computable value isn't state)
  const debouncedValue = useDebouncedValue(value, LINT_DEBOUNCE_MS);
  const compileErr = useMemo(() => {
    const e = debouncedValue.trim();
    return e ? lintJsonata(e) : null;
  }, [debouncedValue]);
  const { state: preview, retry: retryPreview } = useExpressionPreview(value, {
    templateId,
    scope,
  });

  const { start, token } = tokenBefore(value, caret ?? value.length);
  const pick = (path: string) => {
    if (caret == null) {
      onChange(value + path);
    } else {
      onChange(value.slice(0, start) + path + value.slice(caret));
    }
    setDismissed(false);
    requestAnimationFrame(() => ref.current?.focus());
  };

  if (disabled) {
    return value.trim() ? (
      <code className="block rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 font-mono text-[11.5px] break-all">
        {value}
      </code>
    ) : (
      <p className="text-[12px] text-muted-foreground m-0">(none)</p>
    );
  }

  return (
    <div className="grid gap-1">
      <div className="relative">
        <Textarea
          ref={ref}
          value={value}
          rows={rows}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="font-mono text-[11.5px] min-h-[34px]"
          onFocus={(e) => {
            setCaret(e.target.selectionStart ?? value.length);
            setDismissed(false);
          }}
          onBlur={() => setCaret(null)}
          onClick={(e) =>
            setCaret(e.currentTarget.selectionStart ?? value.length)
          }
          onChange={(e) => {
            onChange(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setDismissed(false);
          }}
        />
        {caret != null && !dismissed && options.length > 0 && (
          <PathPopover
            options={options}
            token={token}
            align={align}
            anchor={ref.current}
            onPick={pick}
            onDismiss={() => setDismissed(true)}
          />
        )}
      </div>
      {compileErr && (
        <p className="text-[11px] text-destructive m-0">{compileErr}</p>
      )}
      {!compileErr && <PreviewLine state={preview} retry={retryPreview} />}
    </div>
  );
}
