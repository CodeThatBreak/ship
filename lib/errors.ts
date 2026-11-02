import "server-only";

export const ERROR_CODE = {
  INVALID_INPUT: "invalid_input",
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
  UPSTREAM: "upstream_error",
} as const;
export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];

export class DomainError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: ErrorCode,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, 400, ERROR_CODE.INVALID_INPUT);
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string, id: string) {
    super(`${what} ${id} not found`, 404, ERROR_CODE.NOT_FOUND);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, 409, ERROR_CODE.CONFLICT);
  }
}

export class UpstreamError extends DomainError {
  constructor(message: string, readonly upstreamStatus?: number) {
    super(message, 502, ERROR_CODE.UPSTREAM);
  }
}

export const toErrorResponse = (e: unknown): Response => {
  if (e instanceof DomainError) {
    return Response.json({ error: e.message, code: e.code }, { status: e.status });
  }
  console.error("[api] unhandled error", e);
  return Response.json({ error: "Internal error" }, { status: 500 });
};
