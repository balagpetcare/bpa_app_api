import { Request, Response, NextFunction } from "express";
import * as svc from "./admin_sms.service";

export async function getDashboard(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await svc.getDashboard();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getBalance(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await svc.getBalance();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getLogs(req: Request, res: Response, next: NextFunction) {
  try {
    const page = req.query.page ? Number(req.query.page) : undefined;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const phone = typeof req.query.phone === "string" ? req.query.phone : undefined;
    const data = await svc.getLogs({ page, pageSize, status, phone });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function sendSingle(req: Request, res: Response, next: NextFunction) {
  try {
    const { phone, message } = req.body as { phone?: string; message?: string };
    if (!phone) return res.status(400).json({ success: false, message: "phone is required" });
    const data = await svc.sendSingleSms({ phone, message: message || "" });
    res.json({ success: data.success, data });
  } catch (err) {
    next(err);
  }
}

export async function sendBulk(req: Request, res: Response, next: NextFunction) {
  try {
    const { phones, message } = req.body as { phones?: string[]; message?: string };
    if (!phones?.length) return res.status(400).json({ success: false, message: "phones array is required" });
    const data = await svc.sendBulkAdminSms({ phones, message: message || "" });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function sendCampaign(req: Request, res: Response, next: NextFunction) {
  try {
    const { phones, message, campaignId } = req.body as {
      phones?: string[];
      message?: string;
      campaignId?: number;
    };
    if (!phones?.length) return res.status(400).json({ success: false, message: "phones array is required" });
    const data = await svc.sendCampaignAnnouncement({
      phones,
      message: message || "",
      campaignId,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function retryFailed(req: Request, res: Response, next: NextFunction) {
  try {
    const logId = Number(req.params.id);
    if (!Number.isFinite(logId)) {
      return res.status(400).json({ success: false, message: "Invalid log id" });
    }
    const data = await svc.retrySms(logId);
    res.json({ success: data.success, data });
  } catch (err) {
    next(err);
  }
}
