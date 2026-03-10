/**
 * Policy Guard Middleware
 * Intercepts manager actions (discount, refund, purchase); checks BranchPolicy thresholds.
 * If threshold exceeded, creates ManagerApprovalEscalation and returns 202 (pending approval).
 */

import type { Request, Response, NextFunction } from "express";
import type { EscalationType, CheckEscalationPayload } from "../services/branchPolicy.service";
import {
  checkEscalationRequired,
  createEscalation,
} from "../services/branchPolicy.service";

type RequestWithUser = Request & { user?: { id: number } };

export type PolicyGuardConfig = {
  actionType: EscalationType;
  getBranchId: (req: Request) => number | undefined;
  getPayload: (req: Request) => CheckEscalationPayload;
};

/**
 * Middleware factory: enforce branch policy for manager actions.
 * If escalation is required, creates escalation and responds 202 without calling the route handler.
 */
export function policyGuard(config: PolicyGuardConfig) {
  const { actionType, getBranchId, getPayload } = config;

  return async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }

      const branchId = getBranchId(req);
      if (branchId == null || !Number.isFinite(branchId)) {
        return next();
      }

      const payload = getPayload(req);
      const { required, reason } = await checkEscalationRequired(branchId, actionType, payload);

      if (!required) {
        return next();
      }

      const record = await createEscalation(
        branchId,
        actionType,
        payload as unknown as Record<string, unknown>,
        userId
      );

      return res.status(202).json({
        success: true,
        pendingApproval: true,
        escalationId: record.id,
        message: reason ?? "Action requires owner approval",
      });
    } catch (err: unknown) {
      return next(err);
    }
  };
}

/**
 * Helper for use in controllers: check if action is allowed or needs escalation.
 * Returns { allowed: true } or { allowed: false, escalationId, reason }.
 */
export async function checkPolicyOrEscalation(
  branchId: number,
  actionType: EscalationType,
  payload: CheckEscalationPayload,
  userId: number
): Promise<
  | { allowed: true }
  | { allowed: false; escalationId: number; reason: string }
> {
  const { required, reason } = await checkEscalationRequired(branchId, actionType, payload);
  if (!required) return { allowed: true };

  const record = await createEscalation(
    branchId,
    actionType,
    payload as unknown as Record<string, unknown>,
    userId
  );
  return {
    allowed: false,
    escalationId: record.id,
    reason: reason ?? "Action requires owner approval",
  };
}
