import { describe, expect, it } from "vitest";
import { assignDatabasePath, createIsolatedDatabasePath } from "../../../tests/helpers/in-memory-db";

assignDatabasePath(createIsolatedDatabasePath("devflow-hook-store-"));

const { db } = await import("../../db");
const { hookStore } = await import("./hook-store");

describe("HookStore delivery dedup", () => {
  it("does not record webhook-id until markDeliverySeen (CR-043)", () => {
    const hookId = db.uid("hk_");
    db.run(
      `INSERT INTO hooks (id,template_id,flow_id,node_key,secret,filter,created_at)
       VALUES (?,NULL,NULL,NULL,?,NULL,?)`,
      hookId, "whsec_test", db.now(),
    );
    const deliveryId = "msg_retry_1";

    expect(hookStore.isDeliverySeen(hookId, deliveryId)).toBe(false);
    expect(hookStore.isDeliverySeen(hookId, deliveryId)).toBe(false);

    hookStore.markDeliverySeen(hookId, deliveryId);
    expect(hookStore.isDeliverySeen(hookId, deliveryId)).toBe(true);
  });
});
