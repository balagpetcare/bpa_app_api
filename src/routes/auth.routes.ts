import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { fail, ok } from "../lib/http";
import { hashPassword, signToken, verifyPassword } from "../lib/auth";
import { phoneSchema, passwordSchema } from "../validators/common";
import { authRequired, AuthedRequest } from "../middleware/auth";

export function authRoutes() {
  const r = Router();

  r.post("/register", async (req, res) => {
    const schema = z.object({ phone: phoneSchema, password: passwordSchema });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Validation failed", parsed.error.flatten());

    const { phone, password } = parsed.data;

    const exists = await prisma.user.findUnique({ where: { phone } });
    if (exists) return fail(res, 409, "Phone already registered");

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        phone,
        status: "ACTIVE",
        passwordHash,
        partnerStatus: "NOT_APPLIED",
        authIdentities: { create: { provider: "LOCAL" } },
      },
      select: { id: true, phone: true, status: true },
    });

    const token = signToken(user.id);
    return ok(res, { token, user });
  });

  r.post("/login", async (req, res) => {
    const schema = z.object({ phone: phoneSchema, password: passwordSchema });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Validation failed", parsed.error.flatten());

    const { phone, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { phone }, include: { authIdentities: true } });
    if (!user) return fail(res, 401, "Invalid credentials");
    if (user.status === "BLOCKED") return fail(res, 403, "User is blocked");

    const okPass = await verifyPassword(password, user.passwordHash);
    if (!okPass) return fail(res, 401, "Invalid credentials");

    await prisma.authIdentity.updateMany({
      where: { userId: user.id, provider: "LOCAL" },
      data: { lastLoginAt: new Date() },
    });

    const token = signToken(user.id);
    return ok(res, {
      token,
      user: { id: user.id, phone: user.phone, status: user.status, partnerStatus: user.partnerStatus },
    });
  });

  r.get("/me", authRequired, async (req: AuthedRequest, res) => {
    const uid = req.user!.id;

    const user = await prisma.user.findUnique({
      where: { id: uid },
      select: { id: true, phone: true, status: true, partnerStatus: true },
    });
    if (!user) return fail(res, 404, "User not found");

    const orgs = await prisma.orgMembership.findMany({
      where: { userId: uid, status: "ACTIVE" },
      include: { org: true, role: true },
    });

    const branches = await prisma.branchAssignment.findMany({
      where: { userId: uid, status: "ACTIVE" },
      include: { branch: true, role: true },
    });

    const panels = {
      admin: !!req.user?.isPlatformAdmin,
      partner: orgs.length > 0,
      delivery: branches.some((b) => (b.branch.capabilitiesJson as any)?.delivery === true),
    };

    return ok(res, {
      user,
      orgs: orgs.map((m) => ({ id: m.orgId, role: m.role.code, name: m.org.name, status: m.org.status })),
      branches: branches.map((a) => ({
        branchId: a.branchId,
        orgId: a.branch.orgId,
        role: a.role.code,
        status: a.branch.status,
        capabilities: a.branch.capabilitiesJson,
        features: a.branch.featuresJson,
      })),
      panels,
    });
  });

  return r;
}
