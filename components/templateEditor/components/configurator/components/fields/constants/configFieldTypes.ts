/**
 * The built-in config field types the renderer registry knows — mirrors the
 * closed `ConfigField.type` union in `lib/engine/templates/nodeConfig.ts`
 * (a new type lands there + one constant here + one registry entry).
 */
export const CONFIG_FIELD_TYPE = {
  BOOLEAN: "boolean",
  NUMBER: "number",
  STRING: "string",
  TEXT: "text",
  SELECT: "select",
  JSON: "json",
  TS_OUTPUT: "ts_output",
  CHOICES: "choices",
  MAP: "map",
  MULTI: "multi",
} as const;

export type ConfigFieldType =
  (typeof CONFIG_FIELD_TYPE)[keyof typeof CONFIG_FIELD_TYPE];
