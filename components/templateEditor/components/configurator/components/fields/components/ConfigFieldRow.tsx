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
 * (registered in `../utils/configFieldRenderers.ts` — the type → component
 * lookup is the only dispatch point) and the field-key vocabularies + pure
 * config helpers in `configFieldLogic.ts`, imported directly by consumers.
 */
import { configFieldRendererFor } from "../utils/configFieldRenderers";
import type { ConfigFieldProps } from "../types/configFieldProps";

export const ConfigFieldRow = (props: ConfigFieldProps) => {
  const Renderer = configFieldRendererFor(props.field.type);
  return <Renderer {...props} />;
};