import { NextFunction, Request, Response } from "express";
import { fail } from "../lib/http";
import { verifyToken } from "../lib/auth";
import { prisma } from "../lib/prisma";

export type AuthedRequest = Request & {
  user?: {
    id: number;
    isPlatformAdmin: boolean;
    permissions: string[];
  };
};

export async function authRequired(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return fail(res, 401, "Missing Bearer token");

    const token = header.slice("Bearer ".length);
    const payload = verifyToken(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.uid },
      include: { auth: true, profile: true },
    });

    if (!user) return fail(res, 401, "Invalid token user");
    if (user.status === "BLOCKED") return fail(res, 403, "User is blocked");

    const permissions = new Set<string>();
    const isPlatformAdmin = false;

    req.user = {
      id: user.id,
      isPlatformAdmin,
      permissions: Array.from(permissions),
    };

    return next();
  } catch (e: any) {
    return fail(res, 401, "Unauthorized", e?.message);
  }
}
