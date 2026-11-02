import "server-only";

/** A handler rejected the target URL or outbound request with a specific reason. */
export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}
