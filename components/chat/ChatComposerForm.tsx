"use client";

import type * as React from "react";
import { ArrowUpIcon, PencilIcon, WrenchIcon } from "lucide-react";

import ModelSelector from "./ModelSelector";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ModelChoice } from "@/types/model-spec";
import type { NodeUiCapabilities } from "@/types/node-capabilities";
import PlanOptionToggles from "./PlanOptionToggles";
import type { PlanOptions } from "./types";

/** The chat input form: message textarea, model selector, refine toggle and
 *  (for plan-style nodes) the decompose toggle. Purely presentational — all
 *  state and sending live in the panel and its hooks. */
export default function ChatComposerForm({
  formRef,
  draft,
  onChangeDraft,
  onSend,
  canSend,
  sending,
  inputLocked,
  nodeLabel,
  capabilities,
  refineAvailable,
  refineOn,
  onToggleRefine,
  modelChoice,
  onChangeModelChoice,
  planOptions,
  onChangePlanOptions,
}: {
  formRef: React.RefObject<HTMLFormElement | null>;
  draft: string;
  onChangeDraft: (draft: string) => void;
  onSend: (draft: string) => void;
  canSend: boolean;
  sending: boolean;
  /** locked until the node's first run is generated (prompt-publishing nodes) */
  inputLocked: boolean;
  nodeLabel: string;
  capabilities?: NodeUiCapabilities | null;
  refineAvailable: boolean;
  refineOn: boolean;
  onToggleRefine: () => void;
  modelChoice: ModelChoice | null;
  onChangeModelChoice: (choice: ModelChoice | null) => void;
  planOptions?: PlanOptions;
  onChangePlanOptions?: (opts: PlanOptions) => void;
}) {
  return (
    <form
      ref={formRef}
      className="shrink-0 px-3 pb-4 pt-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSend) return;
        onSend(draft);
      }}
    >
      <InputGroup>
        <InputGroupTextarea
          value={draft}
          onChange={(event) => onChangeDraft(event.target.value)}
          placeholder={
            inputLocked
              ? "Generate the output first to interact with the agent"
              : refineOn
                ? `Refine ${nodeLabel.toLowerCase()}… e.g. 'use the existing auth middleware'`
                : `Message the ${nodeLabel} agent…`
          }
          aria-label="Message"
          disabled={sending || inputLocked}
          className={cn(
            "min-h-16 p-3",
            inputLocked && "cursor-not-allowed opacity-70",
          )}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              formRef.current?.requestSubmit();
            }
          }}
        />
        <InputGroupAddon align="block-end">
          <ModelSelector value={modelChoice} onChange={onChangeModelChoice} />
          {capabilities?.chatOnlyMode === "refine" && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <InputGroupButton
                    size="icon-xs"
                    variant="outline"
                    aria-pressed={refineOn}
                    aria-label={
                      refineOn ? `Mode: refine ${nodeLabel.toLowerCase()}` : "Mode: chat only"
                    }
                    disabled={!refineAvailable}
                    title={
                      refineAvailable
                        ? refineOn
                          ? `Refine — your message regenerates the ${nodeLabel.toLowerCase()}; click to switch to chat only`
                          : "Chat only — just talk without touching the output; click to switch to refine"
                        : "Nothing generated yet — generate one first"
                    }
                    onClick={onToggleRefine}
                    className={cn(
                      !refineAvailable && "opacity-45",
                      refineAvailable &&
                        refineOn &&
                        "border-info/40 bg-info/10 text-info",
                    )}
                  />
                }
              >
                {refineOn ? (
                  <PencilIcon className="size-3" />
                ) : (
                  <WrenchIcon className="size-3" />
                )}
              </TooltipTrigger>
              <TooltipContent>
                {refineOn
                  ? `Refine: your message regenerates the ${nodeLabel.toLowerCase()} with this feedback — click to switch to chat only`
                  : refineAvailable
                    ? "Chat only: message the agent without touching the output — click to enable refine mode"
                    : "Nothing generated yet — generate one first"}
              </TooltipContent>
            </Tooltip>
          )}
          {planOptions && (
            <PlanOptionToggles
              planOptions={planOptions}
              onChange={onChangePlanOptions}
            />
          )}
          <InputGroupButton
            type="submit"
            size="icon-sm"
            className="ml-auto rounded-full"
            disabled={!canSend}
            aria-label="Send"
          >
            <ArrowUpIcon />
            <span className="sr-only">Send</span>
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
