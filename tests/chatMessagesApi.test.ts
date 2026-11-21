/**
 * Regression: GET /api/flows/:id/chat must await the async DB read. Passing the
 * bare Promise to NextResponse.json serializes it to `{}`, so the client hook's
 * `messages ?? []` guard never fires and `useFlowChatMessages` yields `{}`
 * instead of `[]`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const listMessages = vi.fn(async () => [] as unknown[]);

vi.mock("@/lib/db/app", () => ({
  db: { listMessages: (flowId: string) => listMessages(flowId) },
}));

import { GET } from "@/app/api/flows/[id]/chat/route";

describe("GET /api/flows/:id/chat", () => {
  beforeEach(() => listMessages.mockClear());

  it("awaits listMessages and returns an array (empty when there are no messages)", async () => {
    listMessages.mockResolvedValueOnce([]);
    const res = await GET(new Request("http://local/api/flows/f1/chat"), {
      params: Promise.resolve({ id: "f1" }),
    });
    expect(listMessages).toHaveBeenCalledWith("f1");
    expect(await res.json()).toEqual({ messages: [] });
  });

  it("passes decoded messages through unchanged", async () => {
    listMessages.mockResolvedValueOnce([
      { id: "m1", role: "user", content: "hi", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const res = await GET(new Request("http://local/api/flows/f1/chat"), {
      params: Promise.resolve({ id: "f1" }),
    });
    const body = (await res.json()) as { messages: unknown[] };
    expect(body.messages).toHaveLength(1);
    expect(Array.isArray(body.messages)).toBe(true);
  });
});
