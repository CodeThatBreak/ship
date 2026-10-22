"use client";
import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { cn } from "../lib/utils";

type ModelsResponse = { models: string[]; source: string; default: string | null };

let cache: ModelsResponse | null = null;

/** Fetch the selectable model list (CLI-backed, cached for the session). */
export function useModels() {
  const [data, setData] = useState<ModelsResponse | null>(cache);
  useEffect(() => {
    if (cache) return;
    fetch("/api/models")
      .then((r) => r.json())
      .then((d: ModelsResponse) => {
        cache = d;
        setData(d);
      })
      .catch(() => {});
  }, []);
  return data;
}

const DEFAULT_VALUE = "__default__";

/**
 * Model picker for node runs. "" = default (Settings default / account default).
 * shadcn-style dropdown built on the ui/select primitive.
 */
export default function ModelSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (model: string) => void;
  className?: string;
}) {
  const data = useModels();
  const models = data?.models ?? [];
  // Keep a previously chosen value selectable even if the list hasn't loaded it
  const options = value && !models.includes(value) ? [value, ...models] : models;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} title="Model for this run (default: Settings / account default)">
      <Cpu size={13} className="text-muted shrink-0" />
      <Select value={value || DEFAULT_VALUE} onValueChange={(v) => onChange(v === DEFAULT_VALUE ? "" : v)}>
        <SelectTrigger className="max-w-[210px]">
          <span className="truncate">
            <SelectValue placeholder="Model" />
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_VALUE}>
            Default model{data?.default ? ` (${data.default})` : ""}
          </SelectItem>
          {options.map((m) => (
            <SelectItem key={m} value={m}>{m}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </span>
  );
}
