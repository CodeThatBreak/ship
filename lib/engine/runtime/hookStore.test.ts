import { describe, expect, it } from "vitest";

const { db } = await import("../../db/app");
const { hookStore } = await import("./hookStore");
const { maskHookSecret } = await import("./hookStore/utils/maskHookSecret");

describe("maskHookSecret (CR-254)", () => {
  it("masks hook secrets for flow snapshots", () => {
    expect(maskHookSecret("whsec_abcdefghijklmnop")).toBe("••••mnop");
  });
});

describe("HookStore verify fallback", () => {
  const hookId = db.uid("hk_");
  const secret = "whsec_fallback_test";

  const hookFixture = db.prisma.hook
    .create({
      data: {
        id: hookId,
        secret,
        createdAt: new Date(),
      },
    })
    .then(() => hookStore.hook(hookId));
  const hookOf = async () => {
    const hook = await hookFixture;
    if (!hook) throw new Error("hook fixture missing");
    return hook;
  };

  it("rejects x-devflow-secret without webhook-id (CR-196)", async () => {
    const headers = new Headers({
      "x-devflow-secret": secret,
      "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
    });
    expect(hookStore.verify(await hookOf(), "{}", headers).ok).toBe(false);
  });

  it("rejects stale webhook-timestamp on the fallback path (CR-196)", async () => {
    const staleSec = Math.floor(Date.now() / 1000) - 3600;
    const headers = new Headers({
      "x-devflow-secret": secret,
      "webhook-id": "msg_stale",
      "webhook-timestamp": String(staleSec),
    });
    expect(hookStore.verify(await hookOf(), "{}", headers).ok).toBe(false);
  });

  it("accepts fallback deliveries with id, fresh timestamp, and secret", async () => {
    const headers = new Headers({
      "x-devflow-secret": secret,
      "webhook-id": "msg_ok",
      "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
    });
    expect(hookStore.verify(await hookOf(), "{}", headers)).toEqual({ ok: true });
  });
});
