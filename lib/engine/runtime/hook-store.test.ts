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

describe("HookStore verify fallback", () => {
  const hookId = db.uid("hk_");
  const secret = "whsec_fallback_test";

  db.run(
    `INSERT INTO hooks (id,template_id,flow_id,node_key,secret,filter,created_at)
     VALUES (?,NULL,NULL,NULL,?,NULL,?)`,
    hookId, secret, db.now(),
  );

  const hook = hookStore.hook(hookId);
  if (!hook) throw new Error("hook fixture missing");

  it("rejects x-devflow-secret without webhook-id (CR-196)", () => {
    const headers = new Headers({
      "x-devflow-secret": secret,
      "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
    });
    expect(hookStore.verify(hook, "{}", headers).ok).toBe(false);
  });

  it("rejects stale webhook-timestamp on the fallback path (CR-196)", () => {
    const staleSec = Math.floor(Date.now() / 1000) - 3600;
    const headers = new Headers({
      "x-devflow-secret": secret,
      "webhook-id": "msg_stale",
      "webhook-timestamp": String(staleSec),
    });
    expect(hookStore.verify(hook, "{}", headers).ok).toBe(false);
  });

  it("accepts fallback deliveries with id, fresh timestamp, and secret", () => {
    const headers = new Headers({
      "x-devflow-secret": secret,
      "webhook-id": "msg_ok",
      "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
    });
    expect(hookStore.verify(hook, "{}", headers)).toEqual({ ok: true });
  });
});
