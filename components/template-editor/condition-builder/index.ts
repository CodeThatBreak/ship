/**
 * The condition/expression editing surface's public barrel (§1.7): what the
 * other template-editor files and the Inputs tab consume. Deep paths across
 * features are forbidden — import from here.
 */
export { ConditionBuilder } from "./condition-builder";
export { ExpressionInput } from "./expression-input";
export { PreviewLine } from "./preview-line";
export { useExpressionPreview, type ExpressionPreview } from "./use-expression-preview";
export type { Combinator, PreviewScope, PreviewState } from "./types";
