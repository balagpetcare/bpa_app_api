import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { fail, ok } from "../lib/http";
import { authRequired, AuthedRequest } from "../middleware/auth";
import { requirePermission } from "../middleware/requirePermission";

export function adminRoutes() {
  const r = Router();
  r.use(authRequired);

  // Basic gate: must be platform admin (SUPER_ADMIN or BPA_ADMIN)
  r.use((req: AuthedRequest, res, next) => {
    if (!req.user?.isPlatformAdmin) return fail(res, 403, "Admin access required");
    return next();
  });

  // Partner applications
  r.get("/partner/applications", requirePermission("partner.application.read"), async (req, res) => {
    const status = String(req.query.status || "PENDING_REVIEW");

    const items = await prisma.partnerApplication.findMany({
      where: { status: status as any },
      include: { user: { select: { id: true, phone: true } } },
      orderBy: { id: "desc" },
    });

    return ok(res, items);
  });

  r.post("/partner/applications/:id/approve", requirePermission("partner.application.approve"), async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return fail(res, 400, "Invalid id");

    const schema = z.object({ note: z.string().max(500).optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Validation failed", parsed.error.flatten());

    const app = await prisma.partnerApplication.findUnique({ where: { id } });
    if (!app) return fail(res, 404, "Application not found");
    if (app.status !== "PENDING_REVIEW") return fail(res, 409, "Application is not pending");

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.partnerApplication.update({
        where: { id },
        data: {
          status: "APPROVED",
          reviewedAt: new Date(),
          reviewedByAdminId: req.user!.id,
          reviewNote: parsed.data.note,
        },
      });

      await tx.user.update({ where: { id: app.userId }, data: { partnerStatus: "APPROVED" } });

      await tx.auditLog.create({
        data: {
          actorUserId: req.user!.id,
          action: "PARTNER_APPLICATION_APPROVED",
          entityType: "PartnerApplication",
          entityId: String(id),
          metaJson: { note: parsed.data.note ?? null },
        },
      });

      return u;
    });

    return ok(res, updated);
  });

  r.post("/partner/applications/:id/reject", requirePermission("partner.application.approve"), async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return fail(res, 400, "Invalid id");

    const schema = z.object({ note: z.string().min(3).max(500) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Validation failed", parsed.error.flatten());

    const app = await prisma.partnerApplication.findUnique({ where: { id } });
    if (!app) return fail(res, 404, "Application not found");
    if (app.status !== "PENDING_REVIEW") return fail(res, 409, "Application is not pending");

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.partnerApplication.update({
        where: { id },
        data: {
          status: "REJECTED",
          reviewedAt: new Date(),
          reviewedByAdminId: req.user!.id,
          reviewNote: parsed.data.note,
        },
      });

      await tx.user.update({ where: { id: app.userId }, data: { partnerStatus: "REJECTED" } });

      await tx.auditLog.create({
        data: {
          actorUserId: req.user!.id,
          action: "PARTNER_APPLICATION_REJECTED",
          entityType: "PartnerApplication",
          entityId: String(id),
          metaJson: { note: parsed.data.note },
        },
      });

      return u;
    });

    return ok(res, updated);
  });

  // Publish requests
  r.get("/branches/publish-requests", requirePermission("branch.publish.read"), async (req, res) => {
    const status = String(req.query.status || "PENDING");

    const items = await prisma.branchPublishRequest.findMany({
      where: { status: status as any },
      include: { branch: { include: { org: true } } },
      orderBy: { id: "desc" },
    });

    return ok(res, items);
  });

  r.post("/branches/publish-requests/:id/approve", requirePermission("branch.publish.approve"), async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return fail(res, 400, "Invalid id");

    const schema = z.object({
      features: z.object({
        posEnabled: z.boolean().optional(),
        ecommerceEnabled: z.boolean().optional(),
        appointmentsEnabled: z.boolean().optional(),
        walletPayoutsEnabled: z.boolean().optional(),
        inventoryEnabled: z.boolean().optional(),
        courierOpsEnabled: z.boolean().optional(),
      }),
      note: z.string().max(500).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Validation failed", parsed.error.flatten());

    const pr = await prisma.branchPublishRequest.findUnique({ where: { id }, include: { branch: true } });
    if (!pr) return fail(res, 404, "Publish request not found");
    if (pr.status !== "PENDING") return fail(res, 409, "Publish request is not pending");

    const updated = await prisma.$transaction(async (tx) => {
      const branch = pr.branch;
      const nextFeatures = { ...(branch.featuresJson as any), ...(parsed.data.features as any) };

      await tx.branch.update({
        where: { id: pr.branchId },
        data: {
          status: "ACTIVE",
          featuresJson: nextFeatures,
        },
      });

      const reqUpdated = await tx.branchPublishRequest.update({
        where: { id },
        data: {
          status: "APPROVED",
          reviewedAt: new Date(),
          reviewedByAdminId: req.user!.id,
          note: parsed.data.note,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: req.user!.id,
          action: "BRANCH_PUBLISH_APPROVED",
          entityType: "Branch",
          entityId: String(pr.branchId),
          metaJson: { features: nextFeatures, note: parsed.data.note ?? null },
        },
      });

      return reqUpdated;
    });

    return ok(res, updated);
  });

  r.post("/branches/publish-requests/:id/reject", requirePermission("branch.publish.approve"), async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return fail(res, 400, "Invalid id");

    const schema = z.object({ note: z.string().min(3).max(500) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Validation failed", parsed.error.flatten());

    const pr = await prisma.branchPublishRequest.findUnique({ where: { id } });
    if (!pr) return fail(res, 404, "Publish request not found");
    if (pr.status !== "PENDING") return fail(res, 409, "Publish request is not pending");

    const updated = await prisma.$transaction(async (tx) => {
      await tx.branch.update({ where: { id: pr.branchId }, data: { status: "DRAFT" } });

      const reqUpdated = await tx.branchPublishRequest.update({
        where: { id },
        data: {
          status: "REJECTED",
          reviewedAt: new Date(),
          reviewedByAdminId: req.user!.id,
          note: parsed.data.note,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: req.user!.id,
          action: "BRANCH_PUBLISH_REJECTED",
          entityType: "Branch",
          entityId: String(pr.branchId),
          metaJson: { note: parsed.data.note },
        },
      });

      return reqUpdated;
    });

    return ok(res, updated);
  });

  return r;
}
