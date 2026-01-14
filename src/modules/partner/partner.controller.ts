import { Request, Response } from "express";
import * as svc from "./partner.service";

export async function createOrGetDraft(req: Request, res: Response) {
  const userId = req.user!.id;
  const app = await svc.createOrGetDraft(userId, req.body || {});
  res.json(app);
}

export async function listMine(req: Request, res: Response) {
  const userId = req.user!.id;
  const items = await svc.listMine(userId);
  res.json(items);
}

export async function getOneMine(req: Request, res: Response) {
  const userId = req.user!.id;
  const id = Number(req.params.id);
  const item = await svc.getOneMine(userId, id);
  res.json(item);
}

export async function updateDraftMine(req: Request, res: Response) {
  const userId = req.user!.id;
  const id = Number(req.params.id);
  const item = await svc.updateDraftMine(userId, id, req.body || {});
  res.json(item);
}

export async function submitMine(req: Request, res: Response) {
  const userId = req.user!.id;
  const id = Number(req.params.id);
  const item = await svc.submitMine(userId, id);
  res.json(item);
}
