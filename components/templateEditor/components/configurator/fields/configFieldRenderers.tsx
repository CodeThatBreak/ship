"use client";
/**
 * The config-field renderer registry: field `type` → renderer component
 * (design B2 — adding a knob stops requiring an edit to a shared component).
 * A new field type is one constant in `constants/configFieldTypes.ts` + one
 * entry here + the closed `ConfigField.type` union in
 * `lib/engine/templates/nodeConfig.ts` (types are still code). A type this
 * build doesn't know (a newer engine's declaration) renders through the
 * plain-field fallback instead of dropping the knob.
 */
import type { ComponentType } from "react";
import { BooleanFieldRenderer } from "./renderers/BooleanFieldRenderer";
import { ChoicesFieldRenderer } from "./renderers/ChoicesFieldRenderer";
import { JsonFieldRenderer } from "./renderers/JsonFieldRenderer";
import { MapFieldRenderer } from "./renderers/MapFieldRenderer";
import { MultiFieldRenderer } from "./renderers/MultiFieldRenderer";
import { PlainFieldRenderer } from "./renderers/PlainFieldRenderer";
import { SelectFieldRenderer } from "./renderers/SelectFieldRenderer";
import { TextFieldRenderer } from "./renderers/TextFieldRenderer";
import { TsOutputFieldRenderer } from "./renderers/TsOutputFieldRenderer";
import { CONFIG_FIELD_TYPE, type ConfigFieldType } from "./constants/configFieldTypes";
import type { ConfigFieldProps } from "./types/configFieldProps";

export const CONFIG_FIELD_RENDERERS: Record<
  ConfigFieldType,
  ComponentType<ConfigFieldProps>
> = {
  [CONFIG_FIELD_TYPE.BOOLEAN]: BooleanFieldRenderer,
  [CONFIG_FIELD_TYPE.NUMBER]: PlainFieldRenderer,
  [CONFIG_FIELD_TYPE.STRING]: PlainFieldRenderer,
  [CONFIG_FIELD_TYPE.TEXT]: TextFieldRenderer,
  [CONFIG_FIELD_TYPE.SELECT]: SelectFieldRenderer,
  [CONFIG_FIELD_TYPE.JSON]: JsonFieldRenderer,
  [CONFIG_FIELD_TYPE.TS_OUTPUT]: TsOutputFieldRenderer,
  [CONFIG_FIELD_TYPE.CHOICES]: ChoicesFieldRenderer,
  [CONFIG_FIELD_TYPE.MAP]: MapFieldRenderer,
  [CONFIG_FIELD_TYPE.MULTI]: MultiFieldRenderer,
};

/** The fallback renderer for a field type the registry doesn't know. */
export const FALLBACK_FIELD_RENDERER: ComponentType<ConfigFieldProps> =
  PlainFieldRenderer;

const isRegisteredFieldType = (type: string): type is ConfigFieldType =>
  Object.hasOwn(CONFIG_FIELD_RENDERERS, type);

/** Resolve a field's type to its renderer — an unknown type falls back. */
export const configFieldRendererFor = (
  type: string,
): ComponentType<ConfigFieldProps> =>
  isRegisteredFieldType(type)
    ? CONFIG_FIELD_RENDERERS[type]
    : FALLBACK_FIELD_RENDERER;