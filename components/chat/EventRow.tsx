"use client";

import { BotIcon, CircleAlertIcon } from "lucide-react";

import {
  CodeBlock,
  CodeBlockContent,
} from "@/components/ui/code-block";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import type { FeedEvent } from "./timeline";

/** Non-tool events inside a run (errors get a destructive Code Block). */
export default function EventRow({ ev }: { ev: FeedEvent }) {
  const failed = ev.type === "error";
  if (failed) {
    return (
      <TraceCollapsible defaultOpen={false}>
        <TraceCollapsibleTrigger>
          <TraceLine status="error">
            <TraceIcon>
              <CircleAlertIcon />
            </TraceIcon>
            <TraceTitle>{ev.message ?? "Failed"}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent keepMounted>
          <CodeBlock variant="destructive" size="sm">
            <CodeBlockContent wrap className="max-h-64">
              {ev.message ?? "Error"}
            </CodeBlockContent>
          </CodeBlock>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    );
  }

  return (
    <TraceLine>
      <TraceIcon>
        <BotIcon />
      </TraceIcon>
      <TraceTitle>{ev.message ?? ev.type}</TraceTitle>
    </TraceLine>
  );
}
