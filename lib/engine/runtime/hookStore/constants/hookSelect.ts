import "server-only";

/** The aliased hooks-row select every hook read shares. */
export const HOOK_SELECT = `SELECT id, template_id AS "templateId", flow_id AS "flowId",
       node_key AS "nodeKey", secret, filter, created_at AS "createdAt" FROM hooks`;
