"use client";

import { CircleCheckIcon, LoaderCircleIcon } from "lucide-react";

import { Markdown } from "@/components/shared/Markdown";
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
import TaskCollapsible from "./TaskCollapsible";
import type { FeedGroup } from '../timeline';

/** Thinking / status groups inside a run section (Task pattern). */
export default function GroupRow({
  group,
  active,
}: {
  group: FeedGroup;
  active: boolean;
}) {
  if (group.kind === "thinking") {
    return (
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <CircleCheckIcon />
            </TraceIcon>
            <TraceTitle>Thought for a while</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="whitespace-pre-wrap">
          {group.text}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    );
  }

  if (group.kind === "assistant") {
    // agent prose inside a run renders as markdown, right in the section
    return <Markdown className="text-muted-foreground">{group.text}</Markdown>;
  }

  // status lines — collapse anything longer than a short sentence
  const multiline = group.text.includes("\n") || group.text.length > 120;
  if (multiline) {
    return (
      <TaskCollapsible title={group.text.split("\n")[0]} icon={null}>
        <CodeBlock size="sm">
          <CodeBlockContent wrap className="max-h-64">
            {group.text}
          </CodeBlockContent>
        </CodeBlock>
      </TaskCollapsible>
    );
  }

  // the last status in a live section is the live one (statuses coalesce by
  // time, so when the section is still active the final status line is running)
  const running = active;
  return (
    <TraceLine status={running ? "running" : undefined}>
      <TraceIcon>
        {running ? (
          <LoaderCircleIcon className="animate-spin" />
        ) : (
          <CircleCheckIcon />
        )}
      </TraceIcon>
      <TraceTitle>{group.text}</TraceTitle>
    </TraceLine>
  );
}
