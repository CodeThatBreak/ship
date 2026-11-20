import "server-only";

export type TemplateRenderOptions = {
  /** Resolve `{{secrets.NAME}}` at render time (values must not be persisted). */
  resolveSecret?: (name: string) => string | null | undefined;
  /** Label for missing-secret errors. */
  label?: string;
};
