/**
 * Global-Ready Phase 2: API response standard for policy/compliance
 * 403 POLICY_DENIED + reason_code; 202 PENDING_REVIEW
 * Reference: docs/GLOBAL_READY_FULL_PLANNING.md
 */

import { Response } from "express";

/**
 * Send 403 with POLICY_DENIED and reason_code (e.g. DONATION_DISABLED, LIMIT_EXCEEDED)
 */
export function sendPolicyDenied(
  res: Response,
  reasonCode: string,
  message?: string,
  details?: Record<string, unknown>
): void {
  res.status(403).json({
    success: false,
    code: "POLICY_DENIED",
    reason_code: reasonCode,
    message: message || "Feature not allowed in this region",
    ...(details && { details }),
  });
}

/**
 * Send 202 PENDING_REVIEW (e.g. donation held for compliance review)
 */
export function sendPendingReview(
  res: Response,
  message?: string,
  data?: Record<string, unknown>
): void {
  res.status(202).json({
    success: true,
    code: "PENDING_REVIEW",
    message: message || "Request accepted and pending review",
    ...(data && { data }),
  });
}
