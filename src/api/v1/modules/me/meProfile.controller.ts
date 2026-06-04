import type { Request, Response, NextFunction } from "express";
import * as svc from "./meProfile.service";

function uid(req: Request): number | null {
  return svc.getUserId(req);
}

export async function getProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await svc.getEnterpriseProfile(userId);
    if (!data) return res.status(404).json({ success: false, message: "User not found" });
    return res.json({ success: true, data });
  } catch (e) {
    return next(e);
  }
}

export async function patchProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const result = await svc.patchEnterpriseProfile(req, userId, (req.body || {}) as Record<string, unknown>);
    if (result.ok === false) return res.status(result.status).json({ success: false, message: result.message });
    return res.json({ success: true, data: result.data });
  } catch (e) {
    return next(e);
  }
}

export async function getSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await svc.getSettings(userId);
    if (!data) return res.status(404).json({ success: false, message: "User not found" });
    return res.json({ success: true, data });
  } catch (e) {
    return next(e);
  }
}

export async function patchSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const result = await svc.patchSettings(req, userId, (req.body || {}) as Record<string, unknown>);
    if (result.ok === false) return res.status(result.status).json({ success: false, message: result.message });
    return res.json({ success: true, data: result.data });
  } catch (e) {
    return next(e);
  }
}

export async function getSecurity(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await svc.getSecurityInfo(userId);
    return res.json({ success: true, data });
  } catch (e) {
    return next(e);
  }
}

export async function postPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const result = await svc.changePassword(req, userId, (req.body || {}) as Record<string, unknown>);
    if (result.ok === false) return res.status(result.status).json({ success: false, message: result.message });
    return res.json({ success: true, data: result.data });
  } catch (e) {
    return next(e);
  }
}

export async function getCapabilities(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await svc.getCapabilities(req, userId);
    return res.json({ success: true, data });
  } catch (e) {
    return next(e);
  }
}

export async function getBranches(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await svc.getBranches(userId);
    return res.json({ success: true, data });
  } catch (e) {
    return next(e);
  }
}

export async function patchActiveBranch(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const result = await svc.patchActiveBranch(req, userId, (req.body || {}) as Record<string, unknown>);
    if (result.ok === false) return res.status(result.status).json({ success: false, message: result.message });
    return res.json({ success: true, data: result.data });
  } catch (e) {
    return next(e);
  }
}

export async function postProfilePhoto(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const result = await svc.uploadProfilePhoto(req, userId);
    if (result.ok === false) {
      const payload: Record<string, unknown> = { success: false, message: result.message };
      const r = result as { code?: string; meta?: unknown };
      if (r.code) payload.code = r.code;
      if (r.meta !== undefined) payload.meta = r.meta;
      return res.status(result.status).json(payload);
    }
    return res.json({ success: true, data: result.data });
  } catch (e) {
    return next(e);
  }
}

export async function deleteProfilePhoto(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const result = await svc.removeProfilePhoto(req, userId);
    if (result.ok === false) return res.status(result.status).json({ success: false, message: result.message });
    return res.json({ success: true, data: result.data });
  } catch (e) {
    return next(e);
  }
}

export async function getAudit(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const limit = Number(req.query?.limit) || 25;
    const data = await svc.getSelfAudit(userId, limit);
    return res.json({ success: true, data });
  } catch (e) {
    return next(e);
  }
}

const meProfile = {
  getProfile,
  patchProfile,
  postProfilePhoto,
  deleteProfilePhoto,
  getSettings,
  patchSettings,
  getSecurity,
  postPassword,
  getCapabilities,
  getBranches,
  patchActiveBranch,
  getAudit,
};

(module as any).exports = meProfile;
export default meProfile;
