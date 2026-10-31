"use client";
import { useMemo, useRef, useState } from "react";
import { Textarea } from "../../ui/textarea";
import { lintJsonata } from "@/lib/jsonata";
import {
  jsonataPathOptions,
  type VarGroup,
} from "../variables";
import { LINT_DEBOUNCE_MS } from "./constants";
import {
  PathPopover,
  handlePathPopoverKeyDown,
  matchOptions,
  tokenBefore,
} from "./PathAutocomplete";
import { PreviewLine } from "./PreviewLine";
import { useDebouncedValue } from "./useDebouncedValue";
import { useExpressionPreview } from "./useExpressionPreview";
import type { PreviewScope } from "./types";

export const ExpressionInput = ({
  value,
  onChange,
  onBlur,
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
  onChange: (v: string) => void;
  onBlur?: () => void;
  varGroups?: VarGroup[];
  templateId?: string;
  scope?: PreviewScope;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  align?: "left" | "right";
}) => {
  const options = useMemo(
    () => jsonataPathOptions(varGroups ?? []),
    [varGroups],
  );
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
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
  const shown = matchOptions(options, token);
  const count = shown.length;
  const panelOpen =
    !dismissed && menuOpen && count > 0 && caret != null && token.length > 0;

  const pick = (path: string) => {
    if (caret == null) {
      onChange(value + path);
    } else {
      onChange(value.slice(0, start) + path + value.slice(caret));
    }
    setDismissed(false);
    setMenuOpen(false);
    setHighlight(-1);
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
          onFocus={() => setCaret(ref.current?.selectionStart ?? value.length)}
          onBlur={() => {
            setCaret(null);
            setMenuOpen(false);
            onBlur?.();
          }}
          onClick={() => setCaret(ref.current?.selectionStart ?? value.length)}
          onChange={(e) => {
            onChange(e.target.value);
            const nextCaret = e.target.selectionStart ?? e.target.value.length;
            setCaret(nextCaret);
            setDismissed(false);
            const { token: nextToken } = tokenBefore(e.target.value, nextCaret);
            setMenuOpen(nextToken.length > 0);
            setHighlight(-1);
          }}
          onKeyDown={(e) =>
            handlePathPopoverKeyDown({
              e,
              count,
              highlight,
              setHighlight,
              shown,
              onPick: pick,
              onDismiss: () => {
                setDismissed(true);
                setMenuOpen(false);
              },
              menuOpen: panelOpen || menuOpen,
              setMenuOpen,
            })
          }
        />
        {panelOpen && (
          <PathPopover
            options={options}
            token={token}
            align={align}
            anchor={ref.current}
            highlight={highlight}
            setHighlight={setHighlight}
            onPick={pick}
          />
        )}
      </div>
      {compileErr && (
        <p className="text-[11px] text-destructive m-0">{compileErr}</p>
      )}
      {!compileErr && <PreviewLine state={preview} retry={retryPreview} />}
    </div>
  );
};
