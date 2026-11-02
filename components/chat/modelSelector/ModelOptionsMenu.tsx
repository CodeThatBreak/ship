"use client";
import { ChevronDownIcon, ZapIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroupButton } from "@/components/ui/input-group";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { ModelParameterDefinition } from "./modelParams";
import { isBoolParam, prettyParamValue } from "./modelParams";

/**
 * The options menu (§2.2 presentational subcomponent): fast mode / effort /
 * context for the selected model — boolean params render as a Switch row,
 * everything else as a radio group.
 */
export function ModelOptionsMenu({
  paramDefs,
  effectiveParams,
  valueParams,
  onSetParam,
}: {
  paramDefs: ModelParameterDefinition[];
  /** defaults overlaid with explicit picks — what the rows preselect */
  effectiveParams: Record<string, string>;
  /** the explicitly picked params (the Options button's badge colors) */
  valueParams: Record<string, string>;
  onSetParam: (def: ModelParameterDefinition, rawValue: string | null) => void;
}) {
  const optionsPreview = paramDefs
    .map((def) => {
      const v = effectiveParams[def.id] ?? "";
      if (isBoolParam(def)) {
        // boolean options preview by their on-label ("Fast"), omitted when off
        return v === "true" ? prettyParamValue(def, v) : "";
      }
      return prettyParamValue(def, v);
    })
    .filter(Boolean)
    .join(" · ");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <InputGroupButton
            size="xs"
            variant="outline"
            aria-label="Model options"
            title="Model variants: fast mode, effort, context…"
            className="max-w-[130px]"
          />
        }
      >
        <ZapIcon
          className={cn(
            "size-3 shrink-0",
            Object.keys(valueParams).length > 0 ? "text-warning" : "text-muted-foreground",
          )}
        />
        <span className="truncate text-[11px]">{optionsPreview || "Options"}</span>
        <ChevronDownIcon className="text-muted-foreground size-2.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-64 max-h-80 overflow-y-auto">
        {paramDefs.map((def, i) => (
          <ParamSection key={def.id} first={i === 0}>
            {isBoolParam(def) ? (
              // boolean option → switch row (Fast on/off)
              <div className="flex items-center justify-between gap-2 px-2 py-1.5" data-slot="menu-boolean-item">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {def.displayName ?? def.id}
                </span>
                <Switch
                  size="sm"
                  checked={(effectiveParams[def.id] ?? "") === "true"}
                  onCheckedChange={(checked) => onSetParam(def, checked === true ? "true" : "false")}
                  aria-label={
                    `${def.displayName ?? def.id}: ` +
                    ((effectiveParams[def.id] ?? "") === "true" ? "on" : "off")
                  }
                />
              </div>
            ) : (
              <DropdownMenuRadioGroup
                value={effectiveParams[def.id] ?? ""}
                onValueChange={(v: string | null) => onSetParam(def, v)}
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{def.displayName ?? def.id}</DropdownMenuLabel>
                  {def.values.map(({ value: v, displayName }) => (
                    <DropdownMenuRadioItem key={v} value={v} closeOnClick>
                      {displayName ?? prettyParamValue(def, v)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuRadioGroup>
            )}
          </ParamSection>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One parameter's section, separated from the previous row when present. */
function ParamSection({ children, first }: { children: React.ReactNode; first: boolean }) {
  return (
    <>
      {!first && <DropdownMenuSeparator />}
      {children}
    </>
  );
}
