"use client";
import { ChevronDownIcon, CpuIcon, TriangleAlertIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroupButton } from "@/components/ui/input-group";
import type { CatalogModel } from "@/types/modelSpec";

/**
 * The model menu (§2.2 presentational subcomponent): the trigger button plus
 * the provider-grouped model list, or the §2.8 error / loading states when
 * the catalog request fails or is still in flight.
 */
export function ModelMenu({
  modelLabel,
  valueId,
  byProvider,
  models,
  isLoading,
  isError,
  onSelect,
  onRetry,
}: {
  modelLabel: string;
  /** the selected model id ("" = the account's default) */
  valueId: string;
  /** provider → that provider's models, sorted by provider name */
  byProvider: [string, CatalogModel[]][];
  models: CatalogModel[];
  isLoading: boolean;
  isError: boolean;
  onSelect: (id: string) => void;
  onRetry: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <InputGroupButton
            size="xs"
            variant="outline"
            aria-label={`Model: ${modelLabel}`}
            title={
              isError
                ? "Model catalog failed to load — open the menu to retry"
                : "Model for runs started from this panel"
            }
            className="max-w-[170px]"
          />
        }
      >
        <CpuIcon className="text-muted-foreground size-3 shrink-0" />
        <span className="truncate text-[11px]">{modelLabel}</span>
        <ChevronDownIcon className="text-muted-foreground size-2.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-72 max-h-80 overflow-y-auto">
        {isError ? (
          <ErrorGroup onRetry={onRetry} />
        ) : isLoading && models.length === 0 ? (
          <DropdownMenuLabel>Loading models…</DropdownMenuLabel>
        ) : (
          <DropdownMenuRadioGroup value={valueId} onValueChange={(v: string | null) => onSelect(v ?? "")}>
            {byProvider.map(([provider, group], gi) => (
              <ProviderGroup key={provider} provider={provider} group={group} first={gi === 0} />
            ))}
          </DropdownMenuRadioGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One provider partition: label + that provider's models as radio items. */
function ProviderGroup({ provider, group, first }: { provider: string; group: CatalogModel[]; first: boolean }) {
  return (
    <>
      {!first && <DropdownMenuSeparator />}
      <DropdownMenuGroup>
        <DropdownMenuLabel>{provider}</DropdownMenuLabel>
        {group.map((m) => (
          <DropdownMenuRadioItem key={m.id} value={m.id} closeOnClick>
            {m.displayName}
            {m.description && (
              <span className="text-muted-foreground block max-w-64 truncate text-xs font-normal">
                {m.description}
              </span>
            )}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuGroup>
    </>
  );
}

/** In-menu error state: inline alert + retry action (§2.8). */
function ErrorGroup({ onRetry }: { onRetry: () => void }) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuItem
        onSelect={(event) => {
          event.preventDefault();
          onRetry();
        }}
        className="text-destructive focus:text-destructive"
        title="The model catalog request failed — click to retry"
      >
        <TriangleAlertIcon className="size-3 shrink-0" />
        Models failed to load — click to retry
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );
}
