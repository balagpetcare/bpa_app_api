import { Request, Response } from "express";
import * as svc from "./adminPartner.service";

export async function list(req: Request, res: Response) {
  const status = (req.query.status as string | undefined) || undefined;
  const items = await svc.list(status);
  res.json(items);
}

export async function markUnderReview(req: Request, res: Response) {
  const adminId = req.user!.id;
  const id = Number(req.params.id);
  const item = await svc.markUnderReview(adminId, id);
  res.json(item);
}

export async function approve(req: Request, res: Response) {
  const adminId = req.user!.id;
  const id = Number(req.params.id);
  const item = await svc.approve(adminId, id);
  res.json(item);
}

export async function reject(req: Request, res: Response) {
  const adminId = req.user!.id;
  const id = Number(req.params.id);
  const reason = (req.body?.reason as string | undefined) || "Rejected";
  const item = await svc.reject(adminId, id, reason);
  res.json(item);
}
