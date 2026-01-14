import type { Request, Response, NextFunction } from "express";
import * as service from "./branch.service";

/**
 * Requires orgId in auth context (req.auth.orgId)
 */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    // @ts-ignore
    const orgId = req.auth?.orgId;
    if (!orgId) return res.status(400).json({ message: "orgId missing in auth context" });

    const items = await service.listBranches(orgId);
    res.json({ data: items });
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    // @ts-ignore
    const orgId = req.auth?.orgId;
    if (!orgId) return res.status(400).json({ message: "orgId missing in auth context" });

    const created = await service.createBranch(req, orgId, req.body);
    res.status(201).json({ data: created });
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    const updated = await service.updateBranch(req, id, req.body);
    res.json({ data: updated });
  } catch (e) {
    next(e);
  }
}