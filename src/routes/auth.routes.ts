import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { fail, ok } from "../lib/http";
import { hashPassword, signToken, verifyPassword } from "../lib/auth";
import { phoneSchema, passwordSchema } from "../validators/common";
import type { AuthedRequest } from "../middleware/auth";
import { authRequired } from "../middleware/auth";

export function authRoutes() {
  const r = Router();

  r.post("/register", async (req: Request, res: Response) => {
    const schema = z.object({ phone: phoneSchema, password: passwordSchema });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Validation failed", parsed.error.flatten());

    const { phone, password } = parsed.data;

    const exists = await prisma.userAuth.findUnique({ where: { phone } });
    if (exists) return fail(res, 409, "Phone already registered");

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        status: "ACTIVE" as any,
        auth: {
          create: {
            provider: "LOCAL" as any,
            phone,
            passwordHash,
          } as any,
        },
        profile: { create: { displayName: "New User" } as any },
      } as any,
      include: { auth: true, profile: true },
    });

    const token = signToken(user.id);
    return ok(res, { token, user: { id: user.id, status: user.status } });
  });

  r.post("/login", async (req: Request, res: Response) => {
    const schema = z.object({ phone: phoneSchema, password: passwordSchema });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Validation failed", parsed.error.flatten());

    const { phone, password } = parsed.data;

    const auth = await prisma.userAuth.findUnique({ where: { phone }, include: { user: true } });
    if (!auth?.user) return fail(res, 401, "Invalid credentials");
    if (!auth.passwordHash) return fail(res, 401, "Invalid credentials");

    const okPass = await verifyPassword(password, auth.passwordHash);
    if (!okPass) return fail(res, 401, "Invalid credentials");

    const token = signToken(auth.user.id);
    return ok(res, { token });
  });

  r.get("/me", authRequired, async (req: AuthedRequest, res: Response) => {
    const uid = req.user!.id;

    const user = await prisma.user.findUnique({
      where: { id: uid },
      include: { profile: true, auth: true },
    });

    if (!user) return fail(res, 404, "User not found");

    const orgMembers = await prisma.orgMember.findMany({
      where: { userId: uid, status: "ACTIVE" as any },
      include: { org: true },
      orderBy: { id: "desc" as const },
    });

    const branchMembers = await prisma.branchMember.findMany({
      where: { userId: uid, status: "ACTIVE" as any },
      include: { branch: true },
      orderBy: { id: "desc" as const },
    });

    return ok(res, {
      user: { id: user.id, status: user.status, profile: user.profile, auth: { phone: user.auth?.phone, email: user.auth?.email } },
      orgs: orgMembers.map((m) => ({ id: m.orgId, role: m.role, name: m.org.name, status: m.org.status })),
      branches: branchMembers.map((m) => ({
        branchId: m.branchId,
        orgId: m.orgId,
        role: m.role,
        status: m.branch.status,
        capabilities: m.branch.capabilitiesJson,
        features: m.branch.featuresJson,
      })),
    });
  });

  return r;
}
