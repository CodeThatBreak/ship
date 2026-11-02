/**
 * The settings drawer's task-context section (Phase 3): the template's
 * declared task type picker plus the picked provider's {{task.*}} field chips
 * — the variable vocabulary every node's config offers. Presentational: the
 * picked type travels up through `onPick`.
 */
import { RefreshCw } from "lucide-react";
import { Field, FieldDescription, FieldLabel } from '../../../../ui/field';
import { Button } from '../../../../ui/button';
import { Skeleton } from '../../../../ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../ui/select';
import type { TaskProviderInfo } from '../../../types';

/** A provider's dropdown label — flags unconfigured kinds inline. */
const providerLabel = (p: TaskProviderInfo) =>
  `${p.label} (${p.kind})${p.configured ? "" : " — not configured"}`;

export function TaskContextSection({
  providers,
  taskType,
  readonly,
  pending = false,
  error = null,
  onRetry,
  onPick,
}: {
  providers: TaskProviderInfo[];
  /** the trigger's declared task type (provider fallback already resolved) */
  taskType: string;
  readonly: boolean;
  pending?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onPick: (kind: string) => void;
}) {
  const taskProvider =
    providers.find((p) => p.kind === taskType) ?? providers[0] ?? null;
  return (
    <Field>
      <FieldLabel htmlFor="task-context">Task context</FieldLabel>
      {pending ? (
        <Skeleton className="h-9 w-full rounded-lg" />
      ) : error ? (
        <p className="text-[12px] text-destructive m-0 flex items-center gap-2">
          {error}
          {onRetry && (
            <Button variant="outline" size="xs" onClick={() => void onRetry()}>
              <RefreshCw size={12} /> Retry
            </Button>
          )}
        </p>
      ) : (
        <Select
          value={taskType}
          disabled={readonly || providers.length === 0}
          // Base UI may clear through null — collapse to "" and let the parent's
          // persistence rule (: `|| undefined` → key absent) decide
          onValueChange={(v) => onPick(v ?? "")}
        >
          <SelectTrigger
            id="task-context"
            className="w-full rounded-lg border-border bg-card"
          >
            <SelectValue placeholder="no task providers registered">
              {taskProvider ? providerLabel(taskProvider) : "no task providers registered"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem key={p.kind} value={p.kind}>
                {providerLabel(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {!pending && !error && taskProvider && (
        <div className="flex gap-1 flex-wrap pt-1">
          {taskProvider.contextFields.map((f) => (
            <span
              key={f.key}
              title={`${f.label} — type ${f.type}${f.required ? ", always present" : ""}`}
              className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-mono text-muted-foreground"
            >
              {"{{task." + f.key + "}}"}
            </span>
          ))}
        </div>
      )}
      {!pending && !error && (
        <FieldDescription>
          Flows started from this template run on a{" "}
          {taskProvider?.label ?? taskType} task — its fields (above) are
          available to every node as {"{{task.*}}"} variables, no wiring needed.
        </FieldDescription>
      )}
    </Field>
  );
}
