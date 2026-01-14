import type { Request, Response, NextFunction } from "express";
import * as service from "./role.service";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    // @ts-ignore
    const orgId = req.auth?.orgId;
    if (!orgId) return res.status(400).json({ message: "orgId missing in auth context" });

    const items = await service.listRoles(orgId);
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

    const { key, name } = req.body || {};
    if (!key || !name) return res.status(400).json({ message: "key and name are required" });

    const created = await service.createRole(req, orgId, { key, name });
    res.status(201).json({ data: created });
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    const updated = await service.updateRole(req, id, req.body || {});
    res.json({ data: updated });
  } catch (e) {
    next(e);
  }
}

export async function replacePermissions(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    const keys = (req.body?.keys || []) as string[];
    if (!Array.isArray(keys)) return res.status(400).json({ message: "keys must be an array" });

    const updated = await service.replaceRolePermissions(req, id, keys);
    res.json({ data: updated });
  } catch (e) {
    next(e);
  }
}