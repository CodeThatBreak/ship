"use client";
/**
 * JSON object config knob: local authoring text, parse on blur, emit only
 * valid `Record<string, unknown>` values (never a raw string).
 */
import { useState } from "react";
import { Card } from "../../ui/card";
import { Textarea } from "../../ui/textarea";
import { describeDefault } from "../configFieldLogic";

const formatJson = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "object" && !Array.isArray(value)) {
    return JSON.stringify(value, null, 2);
  }
  return "";
};

export const ConfigJsonField = ({
  effective,
  defaultValue,
  controlId,
  onChange,
}: {
  effective: unknown;
  defaultValue?: unknown;
  controlId: string;
  onChange: (v: unknown) => void;
}) => {
  const [text, setText] = useState(() => formatJson(effective));
  const [err, setErr] = useState<string | null>(null);

  const commit = (raw: string) => {
    const src = raw.trim();
    if (!src) {
      setErr(null);
      onChange(undefined);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(src);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setErr("Expected a JSON object");
        return;
      }
      setErr(null);
      onChange(parsed);
    } catch {
      setErr("Invalid JSON");
    }
  };

  return (
    <>
      <Textarea
        id={controlId}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (err) setErr(null);
        }}
        onBlur={() => commit(text)}
        rows={5}
        className="font-mono text-[12px]"
        placeholder={describeDefault(defaultValue)}
      />
      {err && (
        <Card className="p-2.5 text-[12px] text-destructive border-destructive/30">
          {err}
        </Card>
      )}
    </>
  );
};
