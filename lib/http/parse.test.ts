import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ValidationError } from "../errors";
import { parseJson, parseQuery } from "./parse";

describe("parseJson", () => {
  const schema = z.object({ name: z.string().min(1) });

  it("returns parsed data when the body matches", async () => {
    const req = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ name: "devflow" }),
    });
    await expect(parseJson(req, schema)).resolves.toEqual({ name: "devflow" });
  });

  it("throws ValidationError on invalid JSON", async () => {
    const req = new Request("http://localhost", {
      method: "POST",
      body: "{not json",
    });
    await expect(parseJson(req, schema)).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError when the schema fails", async () => {
    const req = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ name: "" }),
    });
    await expect(parseJson(req, schema)).rejects.toMatchObject({
      message: expect.stringContaining("name"),
    });
  });
});

describe("parseQuery", () => {
  const schema = z.object({
    limit: z.coerce.number().int().min(1).max(500).default(200),
  });

  it("applies defaults for missing params", () => {
    const url = new URL("http://localhost/api/events");
    expect(parseQuery(url, schema)).toEqual({ limit: 200 });
  });

  it("throws ValidationError for non-numeric limit", () => {
    const url = new URL("http://localhost/api/events?limit=abc");
    expect(() => parseQuery(url, schema)).toThrow(ValidationError);
  });

  it("throws ValidationError for out-of-range limit", () => {
    const url = new URL("http://localhost/api/events?limit=-1");
    expect(() => parseQuery(url, schema)).toThrow(ValidationError);
  });
});
