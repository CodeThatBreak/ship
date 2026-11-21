/**
 * Task 02 — config field renderers dispatch by field `type` through the
 * registry (design B2): the snapshot pins the ten built-in types, and the
 * fallback test registers nothing new and renders an unknown type through
 * the plain field.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CONFIG_FIELD_RENDERERS,
  FALLBACK_FIELD_RENDERER,
  configFieldRendererFor,
} from "@/components/templateEditor/components/configurator/fields/configFieldRenderers";
import { CONFIG_FIELD_TYPE } from "@/components/templateEditor/components/configurator/fields/constants/configFieldTypes";
import type { ConfigFieldProps } from "@/components/templateEditor/components/configurator/fields/types/configFieldProps";

// the ten built-in `ConfigField.type` values, spelled out so the snapshot
// fails loudly if the union (or the constants mirror) drifts
const TEN_BUILT_IN_TYPES = [
  "boolean",
  "number",
  "string",
  "text",
  "select",
  "json",
  "ts_output",
  "choices",
  "map",
  "multi",
];

const unknownTypeField: ConfigFieldProps = {
  field: { key: "accent", label: "Accent color", type: "color_picker" },
  value: "#ff0000",
  onChange: () => undefined,
};

describe("config field renderer registry", () => {
  it("pins the ten built-in field types", () => {
    // the constants mirror the engine's closed union, spelled out
    expect(Object.values(CONFIG_FIELD_TYPE).sort()).toEqual(
      [...TEN_BUILT_IN_TYPES].sort(),
    );
    // every built-in type has exactly one registry entry — and nothing else
    expect(Object.keys(CONFIG_FIELD_RENDERERS).sort()).toEqual(
      [...TEN_BUILT_IN_TYPES].sort(),
    );
    for (const type of Object.values(CONFIG_FIELD_TYPE)) {
      expect(typeof CONFIG_FIELD_RENDERERS[type]).toBe("function");
    }
  });

  it("resolves every built-in type to its registered renderer", () => {
    for (const type of Object.values(CONFIG_FIELD_TYPE)) {
      expect(configFieldRendererFor(type)).toBe(CONFIG_FIELD_RENDERERS[type]);
    }
  });

  it("falls back to the plain field for an unknown type and renders it", () => {
    // nothing new registered — a type this build doesn't know yet
    expect(configFieldRendererFor("color_picker")).toBe(FALLBACK_FIELD_RENDERER);
    const html = renderToStaticMarkup(
      createElement(FALLBACK_FIELD_RENDERER, unknownTypeField),
    );
    // the plain field rendered the knob instead of dropping it
    expect(html).toContain("Accent color");
    expect(html).toContain("<input");
  });
});