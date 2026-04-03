import { Request, Response } from "express";
import * as svc from "./reverseLogistics.service";

function orgIdFrom(req: Request): number {
  const q = req.query as Record<string, string>;
  const b = (req.body || {}) as Record<string, unknown>;
  const raw = q.orgId ?? b.orgId;
  const n = raw != null ? parseInt(String(raw), 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) throw new Error("orgId required");
  return n;
}

export async function postStockReturn(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = orgIdFrom(req);
    await svc.assertOrg(userId, orgId);
    const { fromLocationId, toLocationId, reason, items, note } = req.body || {};
    if (!fromLocationId || !toLocationId || !reason || !Array.isArray(items)) {
      return res.status(400).json({ success: false, message: "fromLocationId, toLocationId, reason, items required" });
    }
    const data = await svc.createStockReturn({
      orgId,
      fromLocationId: parseInt(String(fromLocationId), 10),
      toLocationId: parseInt(String(toLocationId), 10),
      reason,
      userId,
      items,
      note,
    });
    return res.status(201).json({ success: true, data });
  } catch (e: any) {
    return res.status(e.message?.includes("Forbidden") ? 403 : 400).json({ success: false, message: e.message });
  }
}

export async function getStockReturns(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = orgIdFrom(req);
    await svc.assertOrg(userId, orgId);
    const q = req.query as Record<string, string>;
    const data = await svc.listStockReturns(orgId, {
      status: q.status,
      page: q.page ? parseInt(q.page, 10) : 1,
      limit: q.limit ? parseInt(q.limit, 10) : 20,
    });
    return res.json({ success: true, ...data });
  } catch (e: any) {
    return res.status(e.message?.includes("Forbidden") ? 403 : 400).json({ success: false, message: e.message });
  }
}

export async function getStockReturn(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = orgIdFrom(req);
    await svc.assertOrg(userId, orgId);
    const id = parseInt((req.params as any).id, 10);
    const data = await svc.getStockReturn(orgId, id);
    if (!data) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(e.message?.includes("Forbidden") ? 403 : 400).json({ success: false, message: e.message });
  }
}

export async function postReceive(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = orgIdFrom(req);
    await svc.assertOrg(userId, orgId);
    const id = parseInt((req.params as any).id, 10);
    const lines = (req.body as any)?.lines as Array<{ itemId: number; quantityReceived: number }>;
    if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ success: false, message: "lines required" });
    const data = await svc.receiveStockReturn({ orgId, id, userId, lines });
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(e.message?.includes("Forbidden") ? 403 : 400).json({ success: false, message: e.message });
  }
}

export async function patchDisposition(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = orgIdFrom(req);
    await svc.assertOrg(userId, orgId);
    const id = parseInt((req.params as any).id, 10);
    const { disposition, linkedVendorReturnId, metaPatch } = req.body || {};
    if (!disposition) return res.status(400).json({ success: false, message: "disposition required" });
    const data = await svc.setDisposition({
      orgId,
      id,
      disposition,
      linkedVendorReturnId,
      metaPatch,
      userId,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(e.message?.includes("Forbidden") ? 403 : 400).json({ success: false, message: e.message });
  }
}

export async function postDispute(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = orgIdFrom(req);
    await svc.assertOrg(userId, orgId);
    const id = parseInt((req.params as any).id, 10);
    const note = (req.body as any)?.note as string | undefined;
    const data = await svc.openDispute(orgId, id, note, userId);
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(e.message?.includes("Forbidden") ? 403 : 400).json({ success: false, message: e.message });
  }
}

export async function getCases(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = orgIdFrom(req);
    await svc.assertOrg(userId, orgId);
    const data = await svc.listCases(orgId);
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(e.message?.includes("Forbidden") ? 403 : 400).json({ success: false, message: e.message });
  }
}

export async function postCase(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = orgIdFrom(req);
    await svc.assertOrg(userId, orgId);
    const { caseType, primaryEntityType, primaryEntityId, metaJson } = req.body || {};
    if (!caseType || !primaryEntityType || primaryEntityId == null) {
      return res.status(400).json({ success: false, message: "caseType, primaryEntityType, primaryEntityId required" });
    }
    const data = await svc.createCase({
      orgId,
      caseType,
      primaryEntityType: String(primaryEntityType),
      primaryEntityId: parseInt(String(primaryEntityId), 10),
      metaJson,
      createdByUserId: userId,
    });
    return res.status(201).json({ success: true, data });
  } catch (e: any) {
    return res.status(e.message?.includes("Forbidden") ? 403 : 400).json({ success: false, message: e.message });
  }
}
