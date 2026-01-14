import type { Request, Response, NextFunction } from "express";
import * as service from "./permission.service";

export async function list(_req: Request, res: Response, next: NextFunction) {
  try {
    const items = await service.listPermissions();
    res.json({ data: items });
  } catch (e) {
    next(e);
  }
}