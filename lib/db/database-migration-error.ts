import "server-only";

/** Thrown when schema bootstrap or a numbered `PRAGMA user_version` migration fails. */
export class DatabaseMigrationError extends Error {
  override readonly name = "DatabaseMigrationError";

  constructor(message: string, options?: { cause?: Error }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
  }
}
