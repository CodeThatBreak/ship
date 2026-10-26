"use client";
/**
 * The fan-out child template picker (Phase 3C), extracted from
 * ConfigFieldRow.tsx: a gallery select of flow templates the node's steps run
 * as. Hidden templates (the auto-wrapped `"<label> · step"` children) never
 * appear — a child template is referenced by id, never picked (§2 data
 * model). Entries show the template name with its node count + description; a
 * template value that no longer resolves still renders (the save-time lint
 * reports it as a problem). Empty selection = auto-select: the built-in
 * `step-build` child under build nodes, the node's own hidden auto-wrap copy
 * otherwise.
 */
import { RefreshCw } from "lucide-react";
import { Button } from "../../ui/button";
import { Skeleton } from "../../ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { useGalleryTemplates } from "../hooks/use-gallery-templates";
import { SelectOption } from "./SelectOption";

/** the empty-selection sentinel: resolve the effective child at run time */
const AUTO_VALUE = "__auto__";

export function FanoutChildPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string | undefined) => void;
}) {
  const templatesQuery = useGalleryTemplates();
  const templates = templatesQuery.data ?? null;
  const known = value && templates?.some((t) => t.id === value);
  return (
    <>
      <Select
        value={value ? (known || templates == null ? value : AUTO_VALUE) : AUTO_VALUE}
        onValueChange={(v) =>
          onChange(v == null ? undefined : v === AUTO_VALUE ? undefined : v)
        }
      >
        <SelectTrigger className="w-full rounded-lg border-border bg-card">
          <SelectValue>
            {templatesQuery.isPending ? (
              <Skeleton className="h-4 w-24" />
            ) : value === ""
              ? "auto-select"
              : known
                ? (templates?.find((t) => t.id === value)?.name ?? value)
                : `${value} (missing template)`}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO_VALUE}>
            <SelectOption
              label="auto-select"
              description="Picks a suitable template for you — the built-in build step on build nodes, a matching template elsewhere"
            />
          </SelectItem>
          {value != null && value !== "" && !known && (
            <SelectItem value={value}>{value} (missing template)</SelectItem>
          )}
          {(templates ?? []).map((t) => (
            <SelectItem key={t.id} value={t.id}>
              <SelectOption
                label={t.name}
                description={`${t.nodeCount ?? 0} node${(t.nodeCount ?? 0) === 1 ? "" : "s"}${t.description ? ` · ${t.description}` : ""}`}
              />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {templatesQuery.isError ? (
        <div className="flex items-center gap-1.5">
          <p className="text-[11px] text-destructive m-0">
            Couldn&apos;t load the template list.
          </p>
          <Button
            variant="outline"
            size="xs"
            onClick={() => void templatesQuery.refetch()}
          >
            <RefreshCw size={10} /> Retry
          </Button>
        </div>
      ) : templates?.length === 0 ? (
        <p className="text-[11px] text-muted-foreground m-0">
          No flow templates in the gallery yet — create one in the template
          editor.
        </p>
      ) : null}
    </>
  );
}
