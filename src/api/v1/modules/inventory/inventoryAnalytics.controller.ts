import { Request, Response } from "express";
import * as service from "./inventoryAnalytics.service";

function parseDate(val: string | undefined): Date | undefined {
  if (!val) return undefined;
  const d = new Date(val);
  return isNaN(d.getTime()) ? undefined : d;
}

export const getMovementSummary = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    if (!q.orgId) return res.status(400).json({ success: false, message: "orgId required" });
    const result = await service.getMovementSummary({
      orgId: parseInt(q.orgId),
      locationId: q.locationId ? parseInt(q.locationId) : undefined,
      variantId: q.variantId ? parseInt(q.variantId) : undefined,
      fromDate: parseDate(q.fromDate),
      toDate: parseDate(q.toDate),
    });
    return res.status(200).json({ success: true, data: result });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const getStockTurnoverReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    if (!q.orgId || !q.fromDate || !q.toDate) {
      return res.status(400).json({ success: false, message: "orgId, fromDate, toDate required" });
    }
    const result = await service.getStockTurnoverReport({
      orgId: parseInt(q.orgId),
      locationId: q.locationId ? parseInt(q.locationId) : undefined,
      fromDate: new Date(q.fromDate),
      toDate: new Date(q.toDate),
      limit: q.limit ? parseInt(q.limit) : 50,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const getAbcAnalysis = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    if (!q.orgId || !q.fromDate || !q.toDate) {
      return res.status(400).json({ success: false, message: "orgId, fromDate, toDate required" });
    }
    const result = await service.getAbcAnalysis({
      orgId: parseInt(q.orgId),
      locationId: q.locationId ? parseInt(q.locationId) : undefined,
      fromDate: new Date(q.fromDate),
      toDate: new Date(q.toDate),
    });
    return res.status(200).json({ success: true, data: result });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const getDeadStock = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    if (!q.orgId) return res.status(400).json({ success: false, message: "orgId required" });
    const result = await service.getDeadStock({
      orgId: parseInt(q.orgId),
      locationId: q.locationId ? parseInt(q.locationId) : undefined,
      daysSinceLastSale: q.days ? parseInt(q.days) : 90,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const reconcileStockBalances = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    if (!q.orgId) return res.status(400).json({ success: false, message: "orgId required" });
    const result = await service.reconcileStockBalances({
      orgId: parseInt(q.orgId),
      locationId: q.locationId ? parseInt(q.locationId) : undefined,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
