import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { fail, ok } from "../lib/http";
import { authRequired, AuthedRequest } from "../middleware/auth";

const docsSchema = z.record(z.string(), z.string()).optional();

function isPartnerApproved(status: string) {
  return status === "APPROVED";
}

function parseJsonSafe(input: any) {
  // we store capabilities/features/address as Json in DB; accept objects directly
  if (input === undefined) return undefined;
  if (typeof input === "object") return input;
  return input;
}

export function partnerRoutes() {
  const r = Router();
  r.use(authRequired);

  // 4) Create/Submit partner application
  r.post("/applications", async (req: AuthedRequest, res) => {
    const schema = z.object({
      businessName: z.string().min(2).max(200),
      nidNumber: z.string().min(5).max(50),
      tradeLicenseNo: z.string().min(2).max(100).optional(),
      docs: docsSchema,
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Validation failed", parsed.error.flatten());

    const uid = req.user!.id;

    const user = await prisma.user.findUnique({ where: { id: uid } });
    if (!user) return fail(res, 404, "User not found");

    // Only allow one active application (create or update)
    const existing = await prisma.partnerApplication.findFirst({ where: { userId: uid } });

    const app = existing
      ? await prisma.partnerApplication.update({
          where: { id: existing.id },
          data: {
            ...parsed.data,
            status: "PENDING_REVIEW",
            submittedAt: new Date(),
            reviewedAt: null,
            reviewNote: null,
            reviewedByAdminId: null,
          },
        })
      : await prisma.partnerApplication.create({
          data: {
            userId: uid,
            status: "PENDING_REVIEW",
            submittedAt: new Date(),
            ...parsed.data,
          },
        });

    // mirror status on user for faster gating
    await prisma.user.update({ where: { id: uid }, data: { partnerStatus: "PENDING_REVIEW" } });

    return ok(res, app);
  });

  // 5) View my partner application
  r.get("/applications/me", async (req: AuthedRequest, res) => {
    const uid = req.user!.id;
    const app = await prisma.partnerApplication.findFirst({ where: { userId: uid } });
    return ok(res, app ?? null);
  });

  // 6) Create organization (only after partner approved)
  r.post("/organizations", async (req: AuthedRequest, res) => {
    const schema = z.object({
      name: z.string().min(2).max(200),
      supportPhone: z.string().min(8).max(20),
      address: z.any().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Validation failed", parsed.error.flatten());

    const uid = req.user!.id;
    const user = await prisma.user.findUnique({ where: { id: uid } });
    if (!user) return fail(res, 404, "User not found");

    if (!isPartnerApproved(user.partnerStatus)) {
      return fail(res, 403, "Partner approval required to create organization", {
        partnerStatus: user.partnerStatus,
      });
    }

    const ownerRole = await prisma.role.findUnique({ where: { code: "ORG_OWNER" } });
    if (!ownerRole) return fail(res, 500, "Missing seed role ORG_OWNER");

    const org = await prisma.organization.create({
      data: {
        ownerUserId: uid,
        status: "APPROVED",
        name: parsed.data.name,
        supportPhone: parsed.data.supportPhone,
        addressJson: parseJsonSafe(parsed.data.address) ?? {},
        memberships: {
          create: {
            userId: uid,
            roleId: ownerRole.id,
            status: "ACTIVE",
          },
        },
      },
    });

    return ok(res, org);
  });

  // 7) Get my organizations
  r.get("/organizations", async (req: AuthedRequest, res) => {
    const uid = req.user!.id;
    const memberships = await prisma.orgMembership.findMany({
      where: { userId: uid, status: "ACTIVE" },
      include: { org: true, role: true },
    });

    return ok(
      res,
      memberships.map((m) => ({
        id: m.orgId,
        name: m.org.name,
        status: m.org.status,
        role: m.role.code,
      }))
    );
  });

  // 8) Create branch (Draft)
  r.post("/organizations/:orgId/branches", async (req: AuthedRequest, res) => {
    const schema = z.object({
      name: z.string().min(2).max(200),
      capabilities: z.any(),
      address: z.any().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Validation failed", parsed.error.flatten());

    const uid = req.user!.id;
    const orgId = Number(req.params.orgId);
    if (!Number.isFinite(orgId)) return fail(res, 400, "Invalid orgId");

    // must be member of org (owner/admin)
    const membership = await prisma.orgMembership.findFirst({
      where: { orgId, userId: uid, status: "ACTIVE" },
      include: { role: true },
    });
    if (!membership) return fail(res, 403, "Not a member of this organization");

    const branch = await prisma.branch.create({
      data: {
        orgId,
        name: parsed.data.name,
        status: "DRAFT",
        verificationStatus: "UNSUBMITTED",
        capabilitiesJson: parseJsonSafe(parsed.data.capabilities) ?? {},
        featuresJson: {
          posEnabled: false,
          ecommerceEnabled: false,
          appointmentsEnabled: false,
          walletPayoutsEnabled: false,
          inventoryEnabled: false,
          courierOpsEnabled: false,
        },
        addressJson: parseJsonSafe(parsed.data.address) ?? {},
      },
    });

    // auto-assign org owner as branch manager for convenience
    const managerRole = await prisma.role.findUnique({ where: { code: "BRANCH_MANAGER" } });
    if (managerRole) {
      await prisma.branchAssignment.upsert({
        where: { userId_branchId: { userId: uid, branchId: branch.id } },
        update: { status: "ACTIVE", roleId: managerRole.id },
        create: { userId: uid, branchId: branch.id, roleId: managerRole.id, status: "ACTIVE" },
      });
    }

    return ok(res, branch);
  });

  // 9) Update branch setup
  r.patch("/branches/:branchId", async (req: AuthedRequest, res) => {
    const schema = z
      .object({
        name: z.string().min(2).max(200).optional(),
        address: z.any().optional(),
        capabilities: z.any().optional(),
      })
      .strict();

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Validation failed", parsed.error.flatten());

    const uid = req.user!.id;
    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) return fail(res, 400, "Invalid branchId");

    const assignment = await prisma.branchAssignment.findFirst({ where: { branchId, userId: uid, status: "ACTIVE" } });
    if (!assignment) {
      // org owner can also edit
      const branch = await prisma.branch.findUnique({ where: { id: branchId } });
      if (!branch) return fail(res, 404, "Branch not found");

      const membership = await prisma.orgMembership.findFirst({ where: { orgId: branch.orgId, userId: uid, status: "ACTIVE" } });
      if (!membership) return fail(res, 403, "Not allowed");
    }

    const updated = await prisma.branch.update({
      where: { id: branchId },
      data: {
        name: parsed.data.name,
        addressJson: parsed.data.address ? parseJsonSafe(parsed.data.address) : undefined,
        capabilitiesJson: parsed.data.capabilities ? parseJsonSafe(parsed.data.capabilities) : undefined,
      },
    });

    return ok(res, updated);
  });

  // 11) Submit publish request
  r.post("/branches/:branchId/publish", async (req: AuthedRequest, res) => {
    const uid = req.user!.id;
    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) return fail(res, 400, "Invalid branchId");

    const branch = await prisma.branch.findUnique({ where: { id: branchId }, include: { org: true } });
    if (!branch) return fail(res, 404, "Branch not found");

    // must be org member
    const membership = await prisma.orgMembership.findFirst({
      where: { orgId: branch.orgId, userId: uid, status: "ACTIVE" },
    });
    if (!membership) return fail(res, 403, "Not allowed");

    if (branch.status !== "DRAFT") return fail(res, 400, "Branch is not in DRAFT");

    // minimal required fields check (extend as you like)
    if (!branch.name || Object.keys((branch.addressJson as any) ?? {}).length === 0) {
      return fail(res, 400, "Branch is missing required setup info", {
        required: ["name", "address"],
      });
    }

    const updated = await prisma.branch.update({
      where: { id: branchId },
      data: { status: "PENDING_REVIEW", verificationStatus: "SUBMITTED" },
    });

    const pr = await prisma.branchPublishRequest.create({
      data: { branchId, status: "PENDING", submittedAt: new Date() },
    });

    return ok(res, { branch: updated, publishRequest: pr });
  });

  // 12) Check publish status
  r.get("/branches/:branchId/publish", async (req: AuthedRequest, res) => {
    const uid = req.user!.id;
    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) return fail(res, 400, "Invalid branchId");

    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) return fail(res, 404, "Branch not found");

    const membership = await prisma.orgMembership.findFirst({ where: { orgId: branch.orgId, userId: uid, status: "ACTIVE" } });
    if (!membership) return fail(res, 403, "Not allowed");

    const latest = await prisma.branchPublishRequest.findFirst({
      where: { branchId },
      orderBy: { id: "desc" },
    });

    return ok(res, { branchStatus: branch.status, publishRequest: latest ?? null });
  });

  return r;
}
