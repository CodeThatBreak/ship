import "server-only";

/**
 * The secret-echo closure (step 04, task 8 — Phase-1 finding A2): the RAW
 * response body passes through `secretStore.redact` BEFORE anything derives
 * from it, so the default output, the response_map input, the artifact digest
 * and the reply all carry the redacted text — a secret reflected by an
 * endpoint never persists into `nodes.output`/artifacts in plaintext.
 *
 * A tiny pure seam on purpose: the node owns the wiring (which redactor,
 * where in the pipeline), this owns the ordering guarantee and is unit-tested
 * against a stubbed redactor — `guardedRequest` itself is not injectable.
 */
export const redactResponseBody = async (
  raw: string,
  redact: (s: string) => Promise<string>,
): Promise<string> => {
  return await redact(raw);
};
