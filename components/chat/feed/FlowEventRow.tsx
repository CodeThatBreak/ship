"use client";

import { BotIcon, CircleAlertIcon, CircleMinusIcon } from "lucide-react";

import {
  CodeBlock,
  CodeBlockContent,
} from "@/components/ui/code-block";
import {
  Trace,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import TaskCollapsible from "./TaskCollapsible";
import type { FeedEvent } from '../timeline';
import { FLOW_EVENT_TYPE } from "@/constants/events";

/** Flow-level event row (MR pushes, pipeline results, checklist edits; a
 *  skipped duplicate trigger stays a muted debug-level line). */
export default function FlowEventRow({ ev }: { ev: FeedEvent }) {
  const failed = ev.type === FLOW_EVENT_TYPE.ERROR;
  const steps = parseSteps(ev);

  if (ev.type === FLOW_EVENT_TYPE.SKIPPED_DUPLICATE_TRIGGER) {
    return (
      <Trace>
        <TraceLine status="pending">
          <TraceIcon>
            <CircleMinusIcon />
          </TraceIcon>
          <TraceTitle>{ev.message ?? "skipped duplicate trigger"}</TraceTitle>
        </TraceLine>
      </Trace>
    );
  }

  if (failed || steps) {
    return (
      <Trace>
        <TaskCollapsible
          defaultOpen={failed}
          title={ev.message ?? (failed ? "Failed" : "Update")}
          status={failed ? "error" : undefined}
          icon={failed ? <CircleAlertIcon /> : null}
        >
          <CodeBlock variant={failed ? "destructive" : "default"} size="sm">
            <CodeBlockContent wrap className="max-h-64">
              {failed ? (ev.message ?? "Error") : prettySteps(steps ?? [])}
            </CodeBlockContent>
          </CodeBlock>
        </TaskCollapsible>
      </Trace>
    );
  }

  return (
    <Trace>
      <TraceLine>
        <TraceIcon>
          <BotIcon />
        </TraceIcon>
        <TraceTitle>{ev.message ?? ev.type}</TraceTitle>
      </TraceLine>
    </Trace>
  );
}

/** A step pulled from a flow event's `data.steps` payload. `unknown` here —
 *  the values pass through unvalidated into prettySteps, which joins them
 *  (String-coercing, exactly like the previous untyped version). */
type ParsedStep = {
  title?: unknown;
  detail?: unknown;
  status?: unknown;
};

function parseSteps(ev: FeedEvent): ParsedStep[] | null {
  let data: unknown = {};
  try {
    data = ev.data ? JSON.parse(ev.data) : {};
  } catch {
    data = {};
  }
  if (typeof data !== "object" || data === null) return null;
  const steps = (data as Record<string, unknown>).steps;
  if (!Array.isArray(steps) || steps.length === 0) return null;
  return steps.map((raw: unknown) => {
    const s = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    return {
      title: s.title ?? s.id,
      detail: s.detail,
      status: typeof s.status === "string" ? s.status : undefined,
    };
  });
}

function prettySteps(steps: ParsedStep[]): string {
  return steps
    .map((s) => [s.status, s.title, s.detail].filter(Boolean).join(" — "))
    .join("\n");
}
