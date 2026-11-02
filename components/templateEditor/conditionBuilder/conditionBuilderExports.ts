/**
 * The condition/expression editing surface's public barrel (§1.7): what the
 * other template-editor files and the Inputs tab consume. Deep paths across
 * features are forbidden — import from here.
 */
export { ConditionBuilder } from "./ConditionBuilder";
export { ExpressionInput } from "./ExpressionInput";
export { PreviewLine } from "./PreviewLine";
export { useExpressionPreview, type ExpressionPreview } from "./useExpressionPreview";
export type { Combinator, PreviewScope, PreviewState } from "./types";
