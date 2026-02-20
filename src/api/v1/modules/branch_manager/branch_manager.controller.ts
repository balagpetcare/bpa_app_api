import type { Request, Response } from "express";
import {
  getManagedBranchesForUser,
  getBranchManagerKpis,
  getBranchStaffOverview,
} from "../../services/branchManager.service";

function getAuthUserId(req: any): number | null {
  const id =
    req?.user?.id ??
    req?.userId ??
    req?.auth?.userId ??
    req?.authUser?.id ??
    req?.session?.user?.id;

  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * GET /api/v1/branches/managed
 * List all branches that the current user manages (as BRANCH_MANAGER or org owner),
 * filtered by active BranchAccessPermission.
 */
export async function listManagedBranches(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req as any);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const branches = await getManagedBranchesForUser(userId);
    return res.status(200).json({ success: true, data: branches });
  } catch (e: any) {
    console.error("[branch_manager.listManagedBranches] error", e);
    return res
      .status(500)
      .json({ success: false, message: e?.message || "Server error" });
  }
}

/**
 * GET /api/v1/branches/:branchId/manager/kpis
 * Daily KPIs for a specific branch for the current manager.
 */
export async function getKpis(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req as any);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const branchId = Number(req.params.branchId);
    if (!branchId || !Number.isFinite(branchId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid branch id" });
    }

    const kpis = await getBranchManagerKpis(userId, branchId);
    return res.status(200).json({ success: true, data: kpis });
  } catch (e: any) {
    console.error("[branch_manager.getKpis] error", e);
    const message =
      e?.message === "Branch not found" ||
      e?.message?.includes("not authorized")
        ? e.message
        : "Server error";
    const status =
      e?.message === "Branch not found"
        ? 404
        : e?.message?.includes("not authorized")
        ? 403
        : 500;
    return res.status(status).json({ success: false, message });
  }
}

/**
 * GET /api/v1/branches/:branchId/manager/staff
 * Staff overview for a specific branch (manager view).
 */
export async function getStaffOverview(req: Request, res: Response) {
  try {
    const userId = getAuthUserId(req as any);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const branchId = Number(req.params.branchId);
    if (!branchId || !Number.isFinite(branchId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid branch id" });
    }

    const staff = await getBranchStaffOverview(userId, branchId);
    return res.status(200).json({ success: true, data: staff });
  } catch (e: any) {
    console.error("[branch_manager.getStaffOverview] error", e);
    const message =
      e?.message === "Branch not found" ||
      e?.message?.includes("not authorized")
        ? e.message
        : "Server error";
    const status =
      e?.message === "Branch not found"
        ? 404
        : e?.message?.includes("not authorized")
        ? 403
        : 500;
    return res.status(status).json({ success: false, message });
  }
}

