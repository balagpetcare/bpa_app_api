/**
 * Manager module controller: dashboard, staff, reports, escalations.
 */

import type { Request, Response } from "express";
const {
  getManagerDashboard,
  getManagerStaffList,
  assignStaff,
  updateRoster,
  approveLeave,
  getDailyReport,
  getDoctorPerformanceReport,
  getInventoryUsageReport,
  getManagerEscalations,
  createManagerEscalation,
} = require("./manager.service");

function getUserId(req: any): number | null {
  const id = req?.user?.id ?? req?.userId ?? req?.auth?.userId ?? req?.authUser?.id;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function dashboard(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!branchId || !Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branch id" });
    const data = await getManagerDashboard(userId, branchId);
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("[manager.dashboard]", e);
    const status = e?.message === "Branch not found" ? 404 : e?.message?.includes("not authorized") ? 403 : 500;
    return res.status(status).json({ success: false, message: e?.message || "Server error" });
  }
}

export async function staffList(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!branchId || !Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branch id" });
    const data = await getManagerStaffList(userId, branchId);
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("[manager.staffList]", e);
    const status = e?.message === "Branch not found" ? 404 : e?.message?.includes("not authorized") ? 403 : 500;
    return res.status(status).json({ success: false, message: e?.message || "Server error" });
  }
}

export async function staffAssign(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!branchId || !Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branch id" });
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const result = await assignStaff(userId, branchId, payload);
    return res.status(200).json({ success: true, ...result });
  } catch (e: any) {
    console.error("[manager.staffAssign]", e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

export async function rosterUpdate(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!branchId || !Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branch id" });
    const result = await updateRoster(userId, branchId, req.body || {});
    return res.status(200).json({ success: true, ...result });
  } catch (e: any) {
    console.error("[manager.rosterUpdate]", e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

export async function leaveApprove(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!branchId || !Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branch id" });
    const result = await approveLeave(userId, branchId, req.body || {});
    return res.status(200).json({ success: true, ...result });
  } catch (e: any) {
    console.error("[manager.leaveApprove]", e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

export async function reportDaily(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!branchId || !Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branch id" });
    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    const data = await getDailyReport(userId, branchId, date);
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("[manager.reportDaily]", e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

export async function reportDoctors(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!branchId || !Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branch id" });
    const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;
    const data = await getDoctorPerformanceReport(userId, branchId, dateFrom, dateTo);
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("[manager.reportDoctors]", e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

export async function reportInventory(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!branchId || !Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branch id" });
    const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;
    const data = await getInventoryUsageReport(userId, branchId, dateFrom, dateTo);
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("[manager.reportInventory]", e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

export async function escalationsList(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!branchId || !Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branch id" });
    const status = typeof req.query.status === "string" && ["PENDING", "APPROVED", "REJECTED"].includes(req.query.status)
      ? (req.query.status as "PENDING" | "APPROVED" | "REJECTED")
      : undefined;
    const data = await getManagerEscalations(userId, branchId, status);
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("[manager.escalationsList]", e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

export async function escalationCreate(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!branchId || !Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branch id" });
    const { type, payload } = req.body || {};
    if (!type || typeof type !== "string") return res.status(400).json({ success: false, message: "type required" });
    const record = await createManagerEscalation(userId, branchId, type, typeof payload === "object" ? payload : {});
    return res.status(201).json({ success: true, data: record });
  } catch (e: any) {
    console.error("[manager.escalationCreate]", e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}
