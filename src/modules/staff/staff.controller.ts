import type { Request, Response, NextFunction } from "express";
import * as service from "./staff.admin.service";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    // @ts-ignore
    const orgId = req.auth?.orgId;
    if (!orgId) return res.status(400).json({ message: "orgId missing in auth context" });

    const items = await service.listStaff(orgId);
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

    const userId = Number(req.body?.userId);
    if (!userId) return res.status(400).json({ message: "userId is required" });

    const created = await service.createStaff(req, orgId, {
      userId,
      fullName: req.body?.fullName,
      phone: req.body?.phone,
      title: req.body?.title,
    });
    res.status(201).json({ data: created });
  } catch (e) {
    next(e);
  }
}

export async function assignRole(req: Request, res: Response, next: NextFunction) {
  try {
    const staffId = Number(req.params.id);
    const roleId = Number(req.body?.roleId);
    if (!roleId) return res.status(400).json({ message: "roleId is required" });

    const link = await service.assignRole(req, staffId, roleId);
    res.status(201).json({ data: link });
  } catch (e) {
    next(e);
  }
}

export async function assignBranch(req: Request, res: Response, next: NextFunction) {
  try {
    const staffId = Number(req.params.id);
    const branchId = Number(req.body?.branchId);
    if (!branchId) return res.status(400).json({ message: "branchId is required" });

    const link = await service.assignBranch(req, staffId, branchId, req.body?.position);
    res.status(201).json({ data: link });
  } catch (e) {
    next(e);
  }
}