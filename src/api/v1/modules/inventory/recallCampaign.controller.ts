import { Request, Response } from "express";
import * as svc from "./recallCampaign.service";

function orgIdFrom(req: Request): number {
  const q = req.query as Record<string, string>;
  const b = (req.body || {}) as Record<string, unknown>;
  const raw = q.orgId ?? b.orgId;
  const n = raw != null ? parseInt(String(raw), 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) throw new Error("orgId required");
  return n;
}

export async function postCampaign(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = orgIdFrom(req);
    await svc.assertOrg(userId, orgId);
    const { title, externalRef, severity, metaJson } = req.body || {};
    if (!title) return res.status(400).json({ success: false, message: "title required" });
    const data = await svc.createCampaign({
      orgId,
      title: String(title),
      externalRef: externalRef ? String(externalRef) : undefined,
      severity: severity === "URGENT" || severity === "CRITICAL" ? severity : "STANDARD",
      metaJson,
      createdByUserId: userId,
    });
    return res.status(201).json({ success: true, data });
  } catch (e: any) {
    return res.status(e.message?.includes("Forbidden") ? 403 : 400).json({ success: false, message: e.message });
  }
}

export async function getCampaigns(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = orgIdFrom(req);
    await svc.assertOrg(userId, orgId);
    const data = await svc.listCampaigns(orgId);
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(e.message?.includes("Forbidden") ? 403 : 400).json({ success: false, message: e.message });
  }
}

export async function getCampaign(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = orgIdFrom(req);
    await svc.assertOrg(userId, orgId);
    const id = parseInt((req.params as any).id, 10);
    const data = await svc.getCampaignDetail(orgId, id);
    if (!data) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(e.message?.includes("Forbidden") ? 403 : 400).json({ success: false, message: e.message });
  }
}

export async function postAttachRecall(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = orgIdFrom(req);
    await svc.assertOrg(userId, orgId);
    const campaignId = parseInt((req.params as any).id, 10);
    const recallId = parseInt((req.body as any)?.recallId, 10);
    if (!Number.isFinite(recallId)) return res.status(400).json({ success: false, message: "recallId required" });
    const data = await svc.attachRecallToCampaign({ orgId, campaignId, recallId });
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(e.message?.includes("Forbidden") ? 403 : 400).json({ success: false, message: e.message });
  }
}
