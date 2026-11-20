import "server-only";

/** A role in the SDLC builtin chain (plan → build → review → resolve). */
export type ChainRole = "plan" | "build" | "review" | "resolve";
