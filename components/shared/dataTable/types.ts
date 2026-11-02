import type * as React from "react";

/**
 * One row action for the built-in actions column (see `getActions`).
 * The first action renders as an upfront button; everything after it
 * collapses into the ⋯ overflow menu.
 */
export type DataTableAction<TData> = {
  label: string;
  icon?: React.ReactNode;
  title?: string;
  disabled?: boolean;
  destructive?: boolean;
  onSelect?: (row: TData) => void;
  href?: (row: TData) => string;
};
