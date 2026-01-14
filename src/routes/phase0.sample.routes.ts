import { Router } from "express";
import { requirePerm } from "../modules/rbac/rbac.middleware";
import { prisma } from "../lib/prisma";
import { listBranches, createBranch, updateBranch } from "../modules/branch/branch.service";

export const phase0Router = Router();

/**
 * DEV NOTE:
 * For testing without your real auth integration:
 * - send headers: x-user-id, x-org-id
 * - ensure that userId has a StaffProfile under org + role permissions seeded
 */

phase0Router.get("/admin/branches", requirePerm("branch.read"), async (req, res, next) => {
  try {
    // @ts-ignore
    const orgId = req.auth?.orgId;
    if (!orgId) return res.status(400).json({ message: "orgId missing in auth context" });

    const items = await listBranches(orgId);
    res.json({ data: items });
  } catch (e) {
    next(e);
  }
});

phase0Router.post("/admin/branches", requirePerm("branch.write"), async (req, res, next) => {
  try {
    // @ts-ignore
    const orgId = req.auth?.orgId;
    if (!orgId) return res.status(400).json({ message: "orgId missing in auth context" });

    const created = await createBranch(req, orgId, req.body);
    res.status(201).json({ data: created });
  } catch (e) {
    next(e);
  }
});

phase0Router.patch("/admin/branches/:id", requirePerm("branch.write"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const updated = await updateBranch(req, id, req.body);
    res.json({ data: updated });
  } catch (e) {
    next(e);
  }
});

phase0Router.get("/admin/audit", requirePerm("audit.read"), async (_req, res, next) => {
  try {
    const logs = await prisma.auditLog.findMany({ orderBy: { id: "desc" }, take: 100 });
    res.json({ data: logs });
  } catch (e) {
    next(e);
  }
});