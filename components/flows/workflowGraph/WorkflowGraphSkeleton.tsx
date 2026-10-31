import { Skeleton } from "@/components/ui/skeleton";

/** The graph band's height floor (px) — the skeleton reserves it while the
 *  graph-def request pends, and the resolved layout clamps to it as a
 *  minimum, so loading never collapses or grows the band for single-row
 *  graphs (the dagre height is otherwise content-driven). */
export const GRAPH_SKELETON_HEIGHT = 176;

/**
 * The graph band's loading skeleton (§2.8): a single shimmer block at a fixed
 * height — the edges/meta request resolves straight into the laid-out graph,
 * so the interim state just holds the band's space.
 */
export default function WorkflowGraphSkeleton() {
  return (
    <div role="status" aria-label="Loading workflow graph">
      <Skeleton
        className="w-full rounded-lg"
        style={{ height: GRAPH_SKELETON_HEIGHT }}
      />
    </div>
  );
}
