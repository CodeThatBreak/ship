"use client";
/** The `select` renderer: the plain rich select. */
import { PlainFieldRenderer } from "./PlainFieldRenderer";
import type { ConfigFieldProps } from "../../types/configFieldProps";

export const SelectFieldRenderer = (props: ConfigFieldProps) => (
  <PlainFieldRenderer {...props} />
);
