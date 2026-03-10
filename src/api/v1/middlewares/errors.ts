import type { NextFunction, Request, Response } from "express";

/**
 * 404 handler
 */
function notFoundHandler(req: Request, res: Response, next: NextFunction) {
  // #region agent log
  if ((req.originalUrl || "").includes("catalog/import")) {
    fetch("http://127.0.0.1:7242/ingest/8587e4aa-5cb6-4181-b813-5bca1da63be3", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "7204b9" },
      body: JSON.stringify({
        sessionId: "7204b9",
        hypothesisId: "A",
        location: "errors.ts:notFoundHandler",
        message: "404 sent for catalog/import",
        data: { method: req.method, originalUrl: req.originalUrl, path: req.path, baseUrl: req.baseUrl },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  }
  // #endregion
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
