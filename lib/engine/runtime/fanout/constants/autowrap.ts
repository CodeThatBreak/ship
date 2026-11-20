import "server-only";

/** The description prefix that keys the hidden auto-wrap child templates —
 *  `<prefix><sourceTemplateId>:<nodeKey>:<configHash>` (see
 *  `utils/autowrapKey.ts`). `hookStore` and the template gallery both key off
 *  this marker: a hidden auto-wrap template never provisions inbound hooks. */
export const FANOUT_AUTOWRAP_DESC_PREFIX = "fanout-autowrap:";
