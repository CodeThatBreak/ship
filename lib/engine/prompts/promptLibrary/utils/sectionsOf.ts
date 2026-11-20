import "server-only";

import type { PromptBlock } from "../../promptDefaults";
import type { PromptAssembly, PromptSections } from "../types/promptLibrary";

/** Split an assembly into the modal's display sections. */
export const sectionsOf = (asm: PromptAssembly): PromptSections => {
  const text = (kind: PromptBlock["kind"]) =>
    asm.blocks.filter((b) => b.kind === kind).map((b) => b.text).filter(Boolean).join("\n\n");
  return {
    body: asm.body,
    engineRules: text("rules"),
    outputContract: text("contract"),
    runData: asm.blocks.filter((b) => b.kind === "data"),
    final: asm.final,
  };
};
