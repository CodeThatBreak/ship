"use client";
/**
 * The schema-driven config field row (Phase 2 → 6): one `ConfigFieldRow`
 * per knob, dispatched through the field-renderer registry on the field
 * type — TS-lite schema boxes, decision branch choices, pass-down variable
 * maps, the http secrets chips, the fan-out child picker, and the plain
 * string/number/boolean/select controls.
 *
 * Extracted from NodeConfigurator so any host surface can render a kind's
 * full definition form: the builder drawer's Config tab and the Template
 * Nodes page's create/configure dialog share this machinery (one editing
 * experience everywhere, and a new knob declared on a runtime class shows up
 * on both without extra wiring).
 *
 * Decomposed per component standards: the renderers live in `renderers/`
 * (registered in `configFieldRenderers.tsx` — the type → component lookup
 * below is the only dispatch point), their state hooks in `hooks/`, and the
 * shared field-key vocabularies + pure config helpers in
 * `configFieldLogic.ts`. This module stays the public face — the re-exports
 * below keep every existing `./ConfigFieldRow` import (consumers + the
 * feature barrel) valid.
 */
import { configFieldRendererFor } from "./configFieldRenderers";
import type { ConfigFieldProps } from "./types/configFieldProps";

// facade: the consumers (NodeConfigurator, PromptTab, DeclarativeConfigFields)
// and the feature barrel import these from here
export { SelectOption } from './SelectOption';
export { SecretsChipGroup } from './SecretsChipGroup';
export { VariablesPicker } from '../prompt/VariablesPicker';
export {
  companionTextOf,
  freeTextFields,
  promptEditorKeys,
  secretFields,
  secretRefFields,
  secretRefOptions,
  writeConfig,
} from '../../../configFieldLogic';

export const ConfigFieldRow = (props: ConfigFieldProps) => {
  const Renderer = configFieldRendererFor(props.field.type);
  return <Renderer {...props} />;
};