/**
 * Client-safe template linter problem shape. The server linter returns these
 * via POST /api/templates/[id]/validate; the editor underlines refs from them.
 */
export interface LintProblem {
  where: string;
  ref?: string;
  message: string;
  /** the node instance key the problem belongs to (canvas badge target) */
  nodeKey?: string;
  /** the edge's index in the template's edge list (canvas badge target) */
  edgeIndex?: number;
}
