"use client";

import {
  CodeBlock,
  CodeBlockContent,
} from "@/components/ui/code-block";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { ToolIcon } from "./ToolIcon";
import { fmtDuration, prettyJson, summarizeArgs, truncateChars } from '../formatters';
import type { ToolCall } from '../timeline';

/** Tool call: TraceCollapsible with input/output Code Blocks (Tool pattern). */
export default function ToolRow({ tool }: { tool: ToolCall }) {
  const failed = /fail|error/i.test(tool.status);
  const running =
    !tool.result && !failed && /start|running|tool/i.test(tool.status);
  const truncated = tool.events.some((e) => {
    try {
      return JSON.parse(e.data ?? "{}").truncated;
    } catch {
      return false;
    }
  });

  const summary = summarizeArgs(tool.name, tool.args);
  const input = tool.args ? prettyJson(tool.args) : "";
  const output = tool.result
    ? truncateChars(prettyJson(tool.result), 4000)
    : "";

  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine status={failed ? "error" : running ? "running" : undefined}>
          <TraceIcon>
            <ToolIcon name={tool.name} />
          </TraceIcon>
          <TraceTitle>
            {running ? "Running" : failed ? "Failed to run" : "Ran"} {tool.name}
          </TraceTitle>
          {summary && (
            <TraceDescription className="ms-1">{summary}</TraceDescription>
          )}
          {tool.durationMs != null && (
            <TraceDescription className="ms-1">
              {fmtDuration(tool.durationMs)}
            </TraceDescription>
          )}
          {truncated && (
            <TraceDescription className="ms-1">(truncated)</TraceDescription>
          )}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent keepMounted>
        <div className="flex min-w-0 flex-col gap-2 text-foreground">
          {input && (
            <CodeBlock size="sm">
              <CodeBlockContent wrap className="max-h-64">
                {input}
              </CodeBlockContent>
            </CodeBlock>
          )}
          {output && (
            <CodeBlock size="sm" variant={failed ? "destructive" : "default"}>
              <CodeBlockContent wrap className="max-h-64">
                {output}
              </CodeBlockContent>
            </CodeBlock>
          )}
        </div>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
