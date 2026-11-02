import { ArrowLeft, Cloud, Coins, FolderGit2, Frame, GitMerge } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { BranchRow, FlowData } from '@/types/flow';
import { fmtDuration, fmtTokens } from '@/lib/format';
import { FLOW_STATUS } from '@/constants/flow';

// top bar for the flow screen: breadcrumb back to the index, task identity
// (jira / summary / status), execution mode + figma links, then cost / MR /
// run status pinned to the right
export default function FlowHeader({ flow }: { flow: FlowData }) {
  const { task } = flow;
  const mrBranches = (flow.branches ?? []).filter((b: BranchRow) => b.mr_url);
  const cost = flow.cost && flow.cost.runCount > 0 ? flow.cost : undefined;
  // plan fan-out (Phase 4): the flow total includes the step children's runs
  // — the tooltip breaks that share down per step (cost · duration · runs)
  const stepCosts = (flow.planSteps ?? []).filter(s => s.sub_flow && (s.sub_flow.runCount ?? 0) > 0);
  const costTitle =
    cost &&
    `${cost.runCount} run${cost.runCount > 1 ? 's' : ''}${
      cost.tokens ? ` · ${fmtTokens(cost.tokens)}` : ''
    }${stepCosts.length ? ` (incl. ${stepCosts.length} step sub-flow${stepCosts.length > 1 ? 's' : ''})` : ''}`;

  return (
    <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border bg-card px-4">
      <Button variant="ghost" size="sm" className="-ml-1.5 gap-1.5 text-muted-foreground">
        <Link href="/">
          <ArrowLeft className="size-3.5" />
        </Link>
      </Button>
      <Separator orientation="vertical" className="h-4" />

      {task.externalUrl ? (
        <a href={task.externalUrl} target="_blank" rel="noreferrer" className="shrink-0">
          <Badge className="bg-info/10 text-info hover:bg-info/20">{task.key}</Badge>
        </a>
      ) : (
        <Badge className="bg-info/10 text-info shrink-0">{task.key}</Badge>
      )}

      <h1 className="min-w-0 truncate text-sm font-semibold leading-none" title={task.summary}>
        {task.summary}
      </h1>
      <Badge className="shrink-0 bg-warning/10 text-warning">{task.status}</Badge>

      {task.figmaUrls.length > 0 && (
        <a href={task.figmaUrls[0]} target="_blank" rel="noreferrer" className="shrink-0">
          <Badge className="bg-violet-500/10 text-violet-400 hover:bg-violet-500/20">
            <Frame data-icon="inline-start" /> Figma
          </Badge>
        </a>
      )}
      <Badge variant="secondary" className="shrink-0">
        {flow.execution_mode === 'local' ? (
          <>
            <FolderGit2 data-icon="inline-start" /> local
          </>
        ) : (
          <>
            <Cloud data-icon="inline-start" /> cloud
          </>
        )}
      </Badge>

      <div className="flex-1" />

      {cost && (
        <Tooltip>
          <TooltipTrigger render={<Badge variant="secondary" className="cursor-default font-mono text-[11px]" />}>
            <Coins data-icon="inline-start" />
            {cost.totalCents > 0 ? `$${(cost.totalCents / 100).toFixed(2)}` : fmtTokens(cost.tokens) || '0 tok'}
          </TooltipTrigger>
          <TooltipContent>
            {costTitle}
            {stepCosts.length > 0 && (
              <div className="mt-1 grid text-[11px] font-mono max-w-[290px]">
                {stepCosts.map(s => {
                  const sf = s.sub_flow;
                  if (!sf) return null;
                  const cents = sf.costCents ?? 0;
                  return (
                    <div key={s.id} className="flex gap-2 justify-between">
                      <span className="truncate opacity-80">{s.title}</span>
                      <span className="shrink-0">
                        {cents > 0 ? `$${(cents / 100).toFixed(2)}` : 'n/a'}
                        {(sf.durationMs ?? 0) > 0 && ` · ${fmtDuration(sf.durationMs)}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </TooltipContent>
        </Tooltip>
      )}

      {mrBranches.length > 0 ? (
        <span className="flex shrink-0 gap-1">
          {mrBranches.map((b: BranchRow) => (
            <a key={b.id} href={b.mr_url} target="_blank" rel="noreferrer">
              <Badge className="bg-violet-500/10 text-violet-400 hover:bg-violet-500/20">
                <GitMerge data-icon="inline-start" /> {b.name} !{b.mr_iid}
              </Badge>
            </a>
          ))}
        </span>
      ) : flow.mr_url ? (
        <a href={flow.mr_url} target="_blank" rel="noreferrer" className="shrink-0">
          <Badge className="bg-violet-500/10 text-violet-400 hover:bg-violet-500/20">
            <GitMerge data-icon="inline-start" /> MR !{flow.mr_iid}
          </Badge>
        </a>
      ) : (
        <Badge variant="outline" className="shrink-0 text-muted-foreground">
          no MR yet
        </Badge>
      )}

      <Badge className={flow.status === FLOW_STATUS.ACTIVE ? 'bg-success/10 text-success' : undefined}>
        <span
          className={
            flow.status === FLOW_STATUS.ACTIVE
              ? 'size-1.5 animate-pulse rounded-full bg-current'
              : 'size-1.5 rounded-full bg-current'
          }
        />
        {flow.status}
      </Badge>
    </header>
  );
}
