'use client';

import * as React from 'react';
import { CircleAlertIcon, CircleCheckIcon, LoaderCircleIcon } from 'lucide-react';

import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/ui/trace';
import { fmtCost, fmtDuration, fmtTokens } from './formatters';
import GroupRow from './GroupRow';
import ToolRow from './ToolRow';
import EventRow from './EventRow';
import type { FeedItem, RunSection } from './timeline';

/** Run section = the shadcn Task pattern over Trace. */
export default function RunSectionRow({ section }: { section: RunSection }) {
  const [open, setOpen] = React.useState<boolean | undefined>(undefined);
  const f = section.finished;
  const failed = sectionHasError(section);
  const status = failed ? 'error' : section.active ? 'running' : undefined;
  const runningTitle = `${section.label} running`;
  const doneTitle = failed ? `${section.label} failed` : `${section.label} finished`;

  const meta = [
    section.mode,
    f?.model,
    f?.tokens ? fmtTokens(f.tokens) : null,
    f?.cost ? `${fmtCost(f.cost)}${f.estimated ? ' est.' : ''}` : null,
    f?.durationMs ? fmtDuration(f.durationMs) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Trace size="sm">
      <TraceCollapsible open={open ?? status === 'running'} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={status}>
            <TraceIcon>
              {status === 'running' ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : status === 'error' ? (
                <CircleAlertIcon />
              ) : (
                <CircleCheckIcon />
              )}
            </TraceIcon>
            <TraceTitle>{status === 'running' ? runningTitle : doneTitle}</TraceTitle>
            {meta && <TraceDescription className="ms-1">{meta}</TraceDescription>}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent keepMounted>
          <Trace>
            {section.items.map((it, i) => (
              <FeedItemRow key={i} item={it} active={section.active} />
            ))}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function sectionHasError(section: RunSection): boolean {
  return section.items.some(it => {
    if (it.kind === 'event') return it.event.type === 'error';
    if (it.kind === 'tool') return /fail|error/i.test(it.tool.status);
    return false;
  });
}

/** An item inside a run section: a tool call, a coalesced group, or an event. */
function FeedItemRow({ item, active }: { item: FeedItem; active: boolean }) {
  if (item.kind === 'tool') return <ToolRow tool={item.tool} />;
  if (item.kind === 'group') return <GroupRow group={item.group} active={active} />;
  return <EventRow ev={item.event} />;
}
