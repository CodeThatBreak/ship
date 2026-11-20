/**
 * SplitLinkageStore (step 07 split decomposition): the flows-derived
 * `SplitLinkIndex` default. Covered here: the payload parse (foreign
 * payloads read as "no linkage"), the per-consumer link filter, the
 * unit-position ordering (decision 4's deterministic aggregate order) and
 * the per-unit consumer addressing.
 */
import { testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../../tests/helpers/testDatabase";

assignTestDatabase();

const { SplitLinkageStore } = await import("./splitLinkageStore");

const now = () => new Date().toISOString();

beforeAll(async () => {
  await resetTestDatabase();
});

const payloadOf = (parentNodeKey: string, key: string, position: number): unknown =>
  JSON.stringify({ parentNodeKey, unit: { key, title: `unit ${key}`, dependsOn: [], item: { key }, position } });

describe("SplitLinkageStore", () => {
  it("linksOf: one parent's split children for the consumer, in unit (position) order", async () => {
    await testRun(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      "task_link_1", "jira", "LNK-1", "linkage", "open", "task", "P2"
    );
    await testRun(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,'active',$4,$4)`,
      "flw_link_parent", "task_link_1", "parent", now()
    );
    // out-of-order positions + a child belonging to another consumer + a foreign payload
    const children: [string, unknown, string][] = [
      ["flw_link_c2", payloadOf("build", "b", 1), "split"],
      ["flw_link_c0", payloadOf("build", "z", 0), "split"],
      ["flw_link_other", payloadOf("review", "r", 2), "split"],
      ["flw_link_foreign", JSON.stringify({ plan: {}, step: {} }), "split"],
      ["flw_link_non_split", payloadOf("build", "n", 3), "step"],
    ];
    for (const [id, payload, kind] of children) {
      await testRun(
        `INSERT INTO flows (id, task_id, name, status, parent_flow_id, kind, trigger_payload, created_at, updated_at)
         VALUES ($1,$2,$3,'active',$4,$5,$6::jsonb,$7,$7)`,
        id, "task_link_1", id, "flw_link_parent", kind, payload, now()
      );
    }

    const store = new SplitLinkageStore();
    const links = await store.linksOf("flw_link_parent", "build");
    expect(links.map((l) => l.unitKey)).toEqual(["z", "b"]); // position order, consumer-filtered
    expect(links[0]).toMatchObject({ childFlowId: "flw_link_c0", unit: { key: "z", position: 0 } });

    expect(await store.childPayloadOf("flw_link_c2")).toMatchObject({
      parentNodeKey: "build",
      unit: { key: "b", position: 1 },
    });
    expect(await store.childPayloadOf("flw_link_foreign")).toBeNull(); // foreign payload → no linkage
    expect(await store.childPayloadOf("flw_missing")).toBeNull();

    expect(await store.consumerNodeOfUnit("flw_link_parent", "b")).toBe("build");
    expect(await store.consumerNodeOfUnit("flw_link_parent", "ghost")).toBeNull();
  });
});
