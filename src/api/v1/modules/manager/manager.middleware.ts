/**
 * Manager middleware: ensure user has branch manager access for the branch in params.
 */

import type { Request, Response, NextFunction } from "express";
const { assertBranchManagerAccess } = require("../../services/branchManager.service");

type RequestWithUser = Request & { user?: { id: number }; managerBranch?: { id: number; orgId: number; name: string } };

/**
 * Require that the user is a branch manager (or org owner) for req.params.branchId.
 * Attaches req.managerBranch on success.
 */
export async function requireManagerBranch(req: RequestWithUser, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const branchId = Number(req.params.branchId);
    if (!branchId || !Number.isFinite(branchId)) {
      return res.status(400).json({ success: false, message: "Invalid branch id" });
    }
    const { branch } = await assertBranchManagerAccess(userId, branchId);
    (req as RequestWithUser).managerBranch = branch;
    next();
  } catch (e: unknown) {
    const err = e as Error;
    const message = err?.message === "Branch not found" || err?.message?.includes("not authorized")
      ? err.message
      : "Server error";
    const status = err?.message === "Branch not found" ? 404 : err?.message?.includes("not authorized") ? 403 : 500;
    return res.status(status).json({ success: false, message });
  }
}
