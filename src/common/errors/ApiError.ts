class ApiError extends Error {
  public statusCode: number;
  public details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);

    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details;

    // Better stack traces in Node.js
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

module.exports = ApiError;
