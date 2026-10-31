import { describe, expect, it, vi } from "vitest";
import {
  ConflictError,
  ERROR_CODE,
  NotFoundError,
  toErrorResponse,
  ValidationError,
} from "./errors";

describe("toErrorResponse", () => {
  it("maps NotFoundError to 404 with code", async () => {
    const res = toErrorResponse(new NotFoundError("flow", "flw_1"));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "flow flw_1 not found",
      code: ERROR_CODE.NOT_FOUND,
    });
  });

  it("maps ConflictError to 409 with code", async () => {
    const res = toErrorResponse(new ConflictError("plan is already running"));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "plan is already running",
      code: ERROR_CODE.CONFLICT,
    });
  });

  it("maps ValidationError to 400 with code", async () => {
    const res = toErrorResponse(new ValidationError("nodeKey required"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "nodeKey required",
      code: ERROR_CODE.INVALID_INPUT,
    });
  });

  it("maps unknown errors to a generic 500", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = toErrorResponse(new Error("boom"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Internal error" });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
