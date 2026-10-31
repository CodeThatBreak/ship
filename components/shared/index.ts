/**
 * Public surface of components/shared — generic, domain-neutral components
 * only (§2.4). Everything else here is internal.
 */
export { LocalApiProvider } from "./LocalApiProvider";
export { ListSection } from "./ListSection";
export { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
export { DataTable, type DataTableAction } from "./dataTable";
export { FilterPicker, type FilterDef } from "./FilterPicker";
export { Markdown } from "./Markdown";
export { loadHighlighter, highlightCode } from "./highlighter";
export { FormModal, type FormModalWidth } from "./FormModal";
export { SheetFooterHelper } from "./SheetFooterHelper";
export { TabStrip } from "./TabStrip";
export { RouteError, type RouteErrorProps, type RouteErrorShell } from "./RouteError";
export { TableSkeleton } from "./TableSkeleton";
export { EmptyHint } from "./EmptyHint";
export { InlineError } from "./InlineError";
export { Modal } from "./Modal";
