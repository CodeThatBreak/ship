"use client";
import { AlertTriangle, RotateCcw } from "lucide-react";
import type { Node } from "@/types/flow";
import type { PlanValidationIssue } from "./types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Plan-node failure banner: either the generic failed message, or the
 * malformed plan-meta detail (the agent returned a plan but the structured
 * block failed validation even after the automatic retry) with the
 * validation errors.
 */
export function PlanFailureAlert({
  node,
  onRetry,
}: {
  node: Node;
  onRetry: () => void;
}) {
  const malformed = node.output?.malformed === true;
  const validationErrors: PlanValidationIssue[] =
    (node.output?.validationErrors as PlanValidationIssue[] | undefined) ?? [];
  return (
    <Alert variant="destructive">
      <AlertTriangle size={16} className="shrink-0" />
      <div className="flex-1">
        {malformed ? (
          <>
            <span className="font-medium">Malformed plan response</span>
            <p className="text-xs mt-1 mb-0">
              The agent generated a plan but the structured plan-meta
              block failed validation.
              {validationErrors.length > 0 && (
                <ul className="mt-1.5 ml-3 list-disc text-xs text-destructive/80">
                  {validationErrors.map((e, i) => (
                    <li key={i}>
                      {e.path ? `${e.path}: ` : ""}
                      {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </p>
          </>
        ) : (
          <span>
            This step failed — check the activity feed for details.
          </span>
        )}
      </div>
      <Button size="sm" onClick={onRetry}>
        <RotateCcw size={13} /> Retry
      </Button>
    </Alert>
  );
}
