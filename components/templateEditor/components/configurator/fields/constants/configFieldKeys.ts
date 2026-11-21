/** Config knob keys that route a field to a bespoke editor within its type's renderer. */
export const CONFIG_FIELD_KEY = {
  /** http response map — raw JSONata over the response object */
  RESPONSE_MAP: "response_map",
  /** fan-out child template — the gallery picker */
  FANOUT_CHILD: "fanout_child",
} as const;
