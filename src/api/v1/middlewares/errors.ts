import type { NextFunction, Request, Response } from "express";

/**
 * 404 handler
 */
function notFoundHandler(req: Request, res: Response, next: NextFunction) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

/**
 * Global error handler (supports ApiError-style { statusCode, details } and plain Error)
 */
function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  const e = err as any;
  const status: number = Number(e?.statusCode || e?.status || 500);
  const message: string = String(e?.message || "Internal server error");

  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.error(err);
  }

  const payload: any = { success: false, message };
  if (e?.details !== undefined) payload.details = e.details;

  res.status(status).json(payload);
}

module.exports = { notFoundHandler, errorHandler };
