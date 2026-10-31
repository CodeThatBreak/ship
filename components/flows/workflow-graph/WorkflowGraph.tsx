'use client';
import { useMemo } from 'react';
import type { Node } from '@/types/flow';
import { useGraphDef } from '@/hooks/use-graph-def';
import { GraphEdges, type NodePosition } from './GraphEdges';
import { GraphStatusChips } from './GraphStatusChips';
import WorkflowGraphSkeleton, { GRAPH_SKELETON_HEIGHT } from './WorkflowGraphSkeleton';
import { layout, H, W } from './graph-layout';
import { WorkflowNodeCard, type FanoutProgress } from './NodeCard';

// icon resolution lives here (the template builder reuses the same set)
export { ICONS } from './icons';

/**
 * The flow's execution graph (§2.2 container): dagre layout + the presentational
 * layers — edge SVG (`GraphEdges`), node cards (`WorkflowNodeCard`) and the
 * graph-definition request's status chips.
 */
export default function WorkflowGraph({
  nodes,
  flowId,
  selected,
  onSelect,
  currentNode,
  fanout,
}: {
  nodes: Node[];
  flowId?: string;
  selected: string;
  onSelect: (k: string) => void;
  currentNode?: string;
  /** plan fan-out progress per node key — rendered as the card subtitle; the
   *  `state` field is the AGGREGATE child state driving the card colors while
   *  the node orchestrates (its own row stays `running`): failed → red,
   *  awaiting → warning, in-flight → info, resolved → success */
  fanout?: Record<string, FanoutProgress>;
}) {
  const graphQuery = useGraphDef(flowId ?? '');
  const graphDef = graphQuery.data;
  const keys = useMemo(() => nodes.map((n) => n.node_key), [nodes]);
  const edges = useMemo(() => graphDef?.edges ?? [], [graphDef?.edges]);
  const layoutSignature = useMemo(
    () =>
      keys.length === 0
        ? ''
        : `${keys.join('\0')}\n${edges.map(([a, b, label]) => `${a}\t${b}\t${label}`).join('\n')}`,
    [keys, edges],
  );
  const layoutGraph = useMemo(
    () => (layoutSignature ? layout(keys, edges) : null),
    [layoutSignature, keys, edges],
  );

  if (!keys.length) return null;
  // the graph def's initial load (`placeholderData: keepPreviousData` keeps
  // refetches off this path): the interim state is the fixed-height shimmer
  // band, instead of the edgeless node row that would jump when the dagre
  // layout resolves in (§2.8)
  if (graphQuery.isPending) return <WorkflowGraphSkeleton />;

  const g = layoutGraph;
  if (!g) return null;
  const width = Math.max(...keys.map(k => g.node(k).x)) + W;
  // the band never shrinks below the height the skeleton reserved while
  // pending — a smaller dagre layout (single-row graphs come out under the
  // fixed skeleton height) would otherwise collapse the band on resolve and
  // shift the content below it up (§2.8)
  const height = Math.max(
    Math.max(...keys.map(k => g.node(k).y)) + H + 10,
    GRAPH_SKELETON_HEIGHT,
  );
  const positions = new Map(keys.map(k => [k, { x: g.node(k).x, y: g.node(k).y } satisfies NodePosition]));
  const meta = graphDef?.meta ?? {};

  return (
    <div className="relative mx-auto" style={{ width, height }}>
      <GraphEdges
        nodes={nodes}
        edges={edges}
        edgeSpecs={graphDef?.edgeSpecs}
        positions={positions}
        width={width}
        height={height}
      />
      {nodes.map(n => (
        <WorkflowNodeCard
          key={n.node_key}
          node={n}
          meta={meta}
          position={positions.get(n.node_key) ?? { x: 0, y: 0 }}
          selected={selected === n.node_key}
          running={currentNode === n.node_key}
          fanout={fanout?.[n.node_key]}
          onSelect={onSelect}
        />
      ))}
      <GraphStatusChips
        isError={graphQuery.isError}
        onRetry={() => void graphQuery.refetch()}
      />
    </div>
  );
}
