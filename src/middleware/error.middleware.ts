import { NextFunction, Request, Response } from "express";

// CJS export compatibility
const ApiError = require("../common/errors/ApiError");

/**
 * Express error handler compatible with plain Error, ApiError, and http-errors style objects.
 */
type ErrorLike = Error & {
  statusCode?: number;
  status?: number;
  details?: unknown;
};

export const notFound = (req: Request, _res: Response, next: NextFunction) => {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
};

export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // eslint-disable-next-line no-console
  console.error("ERROR:", err);

  const e = err as ErrorLike;
  const status = e?.statusCode ?? e?.status ?? 500;

  res.status(status).json({
    success: false,
    message: e?.message || "Internal Server Error",
    ...(e?.details ? { details: e.details } : {}),
  });
};
