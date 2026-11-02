"use client";

import { BotIcon } from "lucide-react";

import { Markdown } from "@/components/shared/Markdown";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Message,
  MessageContent,
  MessageFooter,
} from "@/components/ui/message";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ChatMessage } from "@/hooks/useFlowChat";

/** One chat turn: user turns as plain bubbles, agent turns as markdown with
 *  a copy action in the footer. */
export default function ChatMessageRow({ msg }: { msg: ChatMessage }) {
  if (msg.role === "user") {
    return (
      <Message align="end">
        <MessageContent>
          <Bubble align="end" variant="muted">
            <BubbleContent className="whitespace-pre-wrap">
              {msg.content}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }

  return (
    <Message>
      <MessageContent className="gap-2">
        <Markdown>{msg.content}</Markdown>
        <MessageFooter className="px-0">
          <MessageActionButton
            label="Copy"
            onClick={() => navigator.clipboard.writeText(msg.content)}
          >
            <BotIcon />
          </MessageActionButton>
        </MessageFooter>
      </MessageContent>
    </Message>
  );
}

function MessageActionButton({
  label,
  children,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}
