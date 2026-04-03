import { Request, Response } from "express";
import * as svc from "./networkBalance.service";

function parseOrgId(req: Request): number {
  const q = req.query as Record<string, string>;
  const b = (req.body || {}) as Record<string, unknown>;
  const raw = q.orgId ?? b.orgId ?? (req.headers["x-org-id"] as string | undefined);
  const n = typeof raw === "string" ? parseInt(raw, 10) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n) || n <= 0) throw new Error("orgId required");
  return n;
}

export async function postRecompute(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    const body = (req.body || {}) as { scope?: string; branchId?: number };
    await svc.assertUserCanAccessOrg(userId, orgId);
    const branchId = body.branchId != null ? Number(body.branchId) : undefined;
    const data = await svc.recomputeNetworkBalance({ orgId, branchId, userId });
    return res.json({ success: true, data });
  } catch (e: any) {
    const code = e.message === "Forbidden: org access" ? 403 : 400;
    return res.status(code).json({ success: false, message: e.message });
  }
}

export async function getRecommendations(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    await svc.assertUserCanAccessOrg(userId, orgId);
    const q = req.query as Record<string, string>;
    const result = await svc.listRecommendations({
      orgId,
      status: q.status,
      branchId: q.branchId ? parseInt(q.branchId, 10) : undefined,
      page: q.page ? parseInt(q.page, 10) : 1,
      limit: q.limit ? parseInt(q.limit, 10) : 30,
    });
    return res.json({ success: true, ...result });
  } catch (e: any) {
    const code = e.message === "Forbidden: org access" ? 403 : 400;
    return res.status(code).json({ success: false, message: e.message });
  }
}

export async function getRecommendationById(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    await svc.assertUserCanAccessOrg(userId, orgId);
    const id = parseInt((req.params as any).id, 10);
    const r = await svc.getRecommendation(orgId, id);
    if (!r) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: r });
  } catch (e: any) {
    const code = e.message === "Forbidden: org access" ? 403 : 400;
    return res.status(code).json({ success: false, message: e.message });
  }
}

export async function postDismiss(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    await svc.assertUserCanAccessOrg(userId, orgId);
    const id = parseInt((req.params as any).id, 10);
    const reason = (req.body as any)?.reason as string | undefined;
    const data = await svc.dismissRecommendation(orgId, id, userId, reason);
    return res.json({ success: true, data });
  } catch (e: any) {
    const code = e.message === "Forbidden: org access" ? 403 : 400;
    return res.status(code).json({ success: false, message: e.message });
  }
}

export async function postAccept(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    await svc.assertUserCanAccessOrg(userId, orgId);
    const id = parseInt((req.params as any).id, 10);
    const body = (req.body || {}) as { target: "WTO" | "STOCK_REQUEST"; overrides?: { qty?: number } };
    if (body.target !== "WTO" && body.target !== "STOCK_REQUEST") {
      return res.status(400).json({ success: false, message: "target must be WTO or STOCK_REQUEST" });
    }
    const data = await svc.acceptRecommendation({
      orgId,
      id,
      userId,
      target: body.target,
      qtyOverride: body.overrides?.qty,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    const code = e.message === "Forbidden: org access" ? 403 : 400;
    return res.status(code).json({ success: false, message: e.message });
  }
}

export async function getLatestSnapshot(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    await svc.assertUserCanAccessOrg(userId, orgId);
    const q = req.query as Record<string, string>;
    const branchId = q.branchId ? parseInt(q.branchId, 10) : undefined;
    const data = await svc.latestSnapshot(orgId, branchId);
    return res.json({ success: true, data });
  } catch (e: any) {
    const code = e.message === "Forbidden: org access" ? 403 : 400;
    return res.status(code).json({ success: false, message: e.message });
  }
}

export async function getRoutes(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    await svc.assertUserCanAccessOrg(userId, orgId);
    const data = await svc.listRoutes(orgId);
    return res.json({ success: true, data });
  } catch (e: any) {
    const code = e.message === "Forbidden: org access" ? 403 : 400;
    return res.status(code).json({ success: false, message: e.message });
  }
}
