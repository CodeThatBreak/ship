"use client";
/**
 * The node configurator's Inputs & outputs tab: the per-source upstream
 * inputs (each connected parent's published outputs) and the node's own
 * published outputs, as declared by the contract.
 */
import { Info, ListChecks } from "lucide-react";
import { Badge } from '../../../../../ui/badge';
import { Skeleton } from '../../../../../ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../../ui/tooltip';
import type { EditorNode, NodeContract } from '../../../../types';
import type { UpstreamGroup } from '../../hooks/useUpstreamGroups';
import { schemaRows } from '../../../../variables';

export function ContractView({
  contract,
  node,
  groups,
}: {
  contract: NodeContract | null;
  node: EditorNode;
  /** the connected upstream nodes' published outputs — this node's input */
  groups: UpstreamGroup[];
}) {
  if (!contract) return <ContractViewSkeleton />;
  const rows = schemaRows(contract.output);
  return (
    <div className="grid gap-4">
      <section>
        <h4 className="text-[12.5px] font-medium mb-1.5 flex items-center gap-1.5">
          <ListChecks size={13} /> Inputs
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex cursor-help text-muted-foreground hover:text-foreground transition-colors">
                  <Info size={12} />
                </span>
              }
            />
            <TooltipContent className="max-w-[300px] whitespace-normal text-left leading-relaxed">
              Inherited from the upstream nodes.
            </TooltipContent>
          </Tooltip>
        </h4>
        {groups.length === 0 && (
          <p className="text-[12px] text-muted-foreground m-0">
            No upstream node — connect one on the canvas; whatever it publishes
            becomes this node&apos;s input (addressed as{" "}
            <code className="font-mono">{`{{input.<field>}}`}</code> in prompts).
          </p>
        )}
        {groups.length > 0 && (
          <p className="text-[11px] text-muted-foreground mt-1 mb-1.5 m-0 first:mt-0">
            The merged view of what arrives (last-finished parent wins on
            conflicts) — map individual fields on the Inputs tab.
          </p>
        )}
        {groups.map((g) => (
          <div key={g.source.key} className="grid gap-1 mb-1.5 last:mb-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[12px] font-medium truncate">{g.label}</span>
              <code className="font-mono text-[10.5px] text-muted-foreground">{g.source.key}</code>
            </div>
            <ContractTable rows={g.fields} empty="(no declared outputs)" />
          </div>
        ))}
      </section>
      <section>
        <h4 className="text-[12.5px] font-medium mb-1.5 flex items-center gap-1.5">
          <ListChecks size={13} /> Outputs
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex cursor-help text-muted-foreground hover:text-foreground transition-colors">
                  <Info size={12} />
                </span>
              }
            />
            <TooltipContent className="max-w-[300px] whitespace-normal text-left leading-relaxed">
              Published to the flow.
            </TooltipContent>
          </Tooltip>
        </h4>
        <ContractTable rows={rows} empty="No declared output fields." />
        {(() => {
          const out = contract.output;
          if (!out || typeof out !== "object") return null;
          const schema = out as Record<string, unknown>;
          return schema.type === "object" &&
            (schema.properties as { markdown?: unknown } | undefined)?.markdown === undefined ? (
            <p className="text-[11px] text-muted-foreground mt-1.5 m-0">
              Addressed downstream as{" "}
              <code className="font-mono">
                {"{{nodes." + node.key + ".output.<field>}}"}
              </code>
            </p>
          ) : null;
        })()}
      </section>
    </div>
  );
}

function ContractTable({
  rows,
  empty,
}: {
  rows: { name: string; type: string; required: boolean }[];
  empty: string;
}) {
  if (!rows.length)
    return <p className="text-[12px] text-muted-foreground m-0">{empty}</p>;
  return (
    <div className="border border-border rounded-lg overflow-hidden text-[12.5px]">
      {rows.map((r) => (
        <div
          key={r.name}
          className="flex items-center gap-2 px-3 py-1.5 border-b border-border last:border-0"
        >
          <code className="font-mono text-info">{r.name}</code>
          <Badge variant="outline" className="text-[10px]">
            {r.type}
          </Badge>
          {r.required && (
            <Badge className="bg-warning/10 text-warning text-[10px]">
              required
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The contract view's loading skeleton (AGENTS.md §2.8): the same two
 * sections — inherited inputs and published outputs — with row-shaped
 * placeholders matching ContractTable's layout.
 */
function ContractViewSkeleton() {
  const sections = ["Inputs", "Outputs"];
  return (
    <div className="grid gap-4" aria-hidden>
      {sections.map((title) => (
        <section key={title}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Skeleton className="size-3.5" />
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="size-3" />
          </div>
          <div className="border border-border rounded-lg overflow-hidden">
            {Array.from({ length: 3 }, (_, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-3 py-1.5 border-b border-border last:border-0"
              >
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3.5 w-12 rounded-full" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
