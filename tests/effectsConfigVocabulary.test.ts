/**
 * The template editor's effects authoring surface must never drift from the
 * engine's closed verb vocabulary: every checkbox option it offers has to be
 * a verb the def schema accepts, and the agent def has to surface the knob.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EffectsConfigFields } from "@/components/templateEditor/components/configurator/fields/EffectsConfigFields";
import {
  EFFECT_LIFECYCLE,
  EFFECT_LIFECYCLE_SECTIONS,
  EFFECT_VERB,
} from "@/constants/effects";

describe("effects config authoring vocabulary", () => {
  it("offers only verbs the engine's lifecycle allowlists accept", async () => {
    const { EFFECT_LIFECYCLE: ENGINE_LIFECYCLE } = await import(
      "@/lib/engine/runtime/effects/constants/effectLifecycles"
    );
    const { EFFECT_VERBS_BY_LIFECYCLE } = await import(
      "@/lib/engine/runtime/effects/constants/effectVerbs"
    );

    expect(EFFECT_LIFECYCLE_SECTIONS.map((s) => s.key).sort()).toEqual(
      [EFFECT_LIFECYCLE.AFTER_APPROVAL, EFFECT_LIFECYCLE.AFTER_SUCCESS].sort(),
    );

    for (const section of EFFECT_LIFECYCLE_SECTIONS) {
      const engineKey =
        section.key === EFFECT_LIFECYCLE.AFTER_APPROVAL
          ? ENGINE_LIFECYCLE.AFTER_APPROVAL
          : ENGINE_LIFECYCLE.AFTER_SUCCESS;
      const allowed = EFFECT_VERBS_BY_LIFECYCLE[engineKey] ?? [];
      expect(section.verbs.length).toBeGreaterThan(0);
      for (const verb of section.verbs) {
        expect(allowed).toContain(verb.value);
      }
    }
  });

  it("offers the MR verb under afterApproval — the panel capability the agent flow needs", () => {
    const afterApproval = EFFECT_LIFECYCLE_SECTIONS.find(
      (s) => s.key === EFFECT_LIFECYCLE.AFTER_APPROVAL,
    );
    expect(afterApproval?.verbs.map((v) => v.value)).toContain(
      EFFECT_VERB.CREATE_CHANGE_REQUEST,
    );
  });

  it("renders both lifecycle sections with their wired verb options", () => {
    const html = renderToStaticMarkup(
      createElement(EffectsConfigFields, {
        field: { key: "effects", label: "Effects", type: "json" },
        value: { afterApproval: [EFFECT_VERB.CREATE_CHANGE_REQUEST] },
        onChange: () => undefined,
      }),
    );
    expect(html).toContain("Effects");
    expect(html).toContain("After approval");
    expect(html).toContain(EFFECT_VERB.CREATE_CHANGE_REQUEST);
    expect(html).toContain("After success");
    expect(html).toContain(EFFECT_VERB.RETRIGGER_PIPELINE);
    // the unwired stub is deliberately not offered
    expect(html).not.toContain(EFFECT_VERB.PUBLISH_DIFF);
  });

  it("surfaces the effects knob on the agent node's authoring form", async () => {
    const { AGENT_CONFIG_FIELDS } = await import(
      "@/lib/engine/nodes/kinds/agent/constants/agentConstantsExports"
    );
    const effects = AGENT_CONFIG_FIELDS.find((f) => f.key === "effects");
    expect(effects).toBeDefined();
    expect(effects?.label).toBe("Effects");
  });
});
