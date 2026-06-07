import type { Request, Response, NextFunction } from "express";
import { getBookingConfirmationPdf } from "./bookingPdf.service";

function pickVerificationCode(req: Request): string | undefined {
  const raw =
    (typeof req.query.code === "string" && req.query.code) ||
    (typeof req.query.verificationCode === "string" && req.query.verificationCode) ||
    "";
  return raw.trim() || undefined;
}

function clientRateKey(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || "unknown";
}

/**
 * GET /api/v1/campaign/bookings/:reference/pdf?code=XXXX-XXXX
 */
export async function bookingPdfHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const reference = String(req.params.reference || "").trim();
    if (!reference) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_INPUT", message: "Booking reference is required" },
      });
    }

    const verificationCode = pickVerificationCode(req);
    const ownerUserId = (req as Request & { user?: { id?: number } }).user?.id;

    if (!verificationCode && ownerUserId == null) {
      return res.status(401).json({
        success: false,
        error: {
          code: "VERIFICATION_REQUIRED",
          message: "Verification code is required to download this PDF",
        },
      });
    }

    const { buffer, filename } = await getBookingConfirmationPdf({
      bookingRef: reference,
      verificationCode,
      ownerUserId,
      clientKey: clientRateKey(req),
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.send(buffer);
  } catch (err) {
    next(err);
  }
}
