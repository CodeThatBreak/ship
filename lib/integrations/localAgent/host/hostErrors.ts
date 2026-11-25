import "server-only";

/** Raised for any failure crossing the local-agent host boundary. */
export class LocalAgentHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalAgentHostError";
  }
}
