import type { InstanceRow } from "../types";

/** Fail loudly when POST /api/*-instances did not return the created row (CR-256). */
export const requireCreatedInstance = (
  body: { instance?: InstanceRow },
): InstanceRow => {
  if (!body.instance) {
    throw new Error("Server did not return the new instance");
  }
  return body.instance;
};
