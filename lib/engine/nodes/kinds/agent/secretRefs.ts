import "server-only";

import { secretStore } from "../../../secretStore";

/**
 * The agent node's `secret_refs` seam (task 15, design §7, finding C1): the
 * one place a declarative agent run turns its DECLARED secret names into
 * runtime material. Two consumers, one read:
 *
 *  - `AgentStartSpec.env` — the declared secrets ride the existing per-run
 *    env channel (cloud `cloud.envVars`; local has no env channel and gets
 *    them through the prompt interpolation instead).
 *  - the prompt resolver — `{{secrets.NAME}}` in the prompt template resolves
 *    ONLY for a declared ref, and a declared ref that resolves to nothing
 *    fails the run loudly (the silent-`""` hole, C1 — the renderer's own
 *    no-resolver `""` fallback stays for surfaces that opt out).
 *
 * The values are resolved at run start, used in-memory, and never persisted:
 * they must not appear in the recorded input blob, artifacts, events, or any
 * row — `redactSecretValues` is the recorded-input half of that invariant.
 */

/** The label prefix every secret error carries (the node that failed). */
export type SecretResolution = {
  /** declared name → resolved value; empty when nothing is declared */
  readonly env: Record<string, string>;
  /** the prompt resolver scoped to the declared refs (throws for anything else) */
  readonly resolver: (name: string) => string;
};

/**
 * Resolve the node's declared `secret_refs` against the SecretStore:
 * a declared ref with no configured value throws (never a silent empty
 * render), undeclared refs are absent by construction. One store read per
 * run; no refs = an inert context (empty env, every prompt ref throws).
 */
export const resolveSecretContext = async (
  refs: readonly string[],
  label: string,
): Promise<SecretResolution> => {
  const declared = new Set(refs.map((r) => r.trim()).filter(Boolean));
  if (declared.size === 0) {
    return { env: {}, resolver: undeclaredSecretResolver(label) };
  }
  const secrets = await secretStore.all();
  const env: Record<string, string> = {};
  for (const name of declared) {
    const value = secrets[name];
    if (value == null || value === "") {
      throw new Error(
        `${label}: secret "${name}" is declared in the node's secret_refs but not configured — add it under Settings → secrets`,
      );
    }
    env[name] = value;
  }
  return { env, resolver: scopedSecretResolver(declared, env, label) };
};

/** The resolver every undeclared ref fails loudly against — the scoping
 *  guard: a prompt cannot reach a secret the node never declared. */
const undeclaredSecretResolver = (label: string): ((name: string) => string) =>
  scopedSecretResolver(new Set<string>(), {}, label);

/**
 * The `{{secrets.NAME}}` resolver scoped to the declared refs: an undeclared
 * name throws (config error — the prompt references a secret the node does
 * not declare), a declared name resolves from the resolved env map (missing
 * = the same loud failure `resolveSecretContext` already enforced).
 */
const scopedSecretResolver = (
  declared: ReadonlySet<string>,
  env: Readonly<Record<string, string>>,
  label: string,
): ((name: string) => string) => {
  return (name: string): string => {
    if (!declared.has(name)) {
      throw new Error(
        `${label}: secret "${name}" is not declared in this node's secret_refs — declare it on the node before referencing {{secrets.${name}}}`,
      );
    }
    const value = env[name];
    if (value == null || value === "") {
      throw new Error(
        `${label}: secret "${name}" is declared but not configured — add it under Settings → secrets`,
      );
    }
    return value;
  };
};

/**
 * Replace every resolved secret value in a rendered text with its
 * `{{secrets.NAME}}` ref — the recorded-input half of the no-persistence
 * invariant: the run record (nodes.input.prompt) shows the template refs,
 * never the values.
 */
export const redactSecretValues = (
  text: string,
  env: Readonly<Record<string, string>>,
): string => {
  let out = text ?? "";
  for (const [name, value] of Object.entries(env)) {
    if (value && out.includes(value)) out = out.split(value).join(`{{secrets.${name}}}`);
  }
  return out;
};
