export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super(message, 403, "forbidden");
  }
}
/** Also used for records outside the caller's tenant: their existence is never confirmed. */
export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, 404, "not_found");
  }
}
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, "validation_failed", details);
  }
}
export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, "conflict", details);
  }
}
export class RateLimitedError extends AppError {
  constructor(message = "Too many requests. Please wait a minute and try again.") {
    super(message, 429, "rate_limited");
  }
}
