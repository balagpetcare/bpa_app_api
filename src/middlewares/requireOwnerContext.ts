/**
 * Optional: require that owner-panel user has at least one context or owns an org.
 * Use after auth + roleGuard. If user has no context and no org, returns 403 with needsOnboarding.
 */
import type { Request, Response, NextFunction } from "express";

const prisma = require("../infrastructure/db/prismaClient").default;

type RequestWithUser = Request & { user?: { id: number } };

export async function requireOwnerContext(req: RequestWithUser, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    const [contextCount, orgCount, ownedTeamsCount] = await Promise.all([
      prisma.userContext.count({ where: { userId } }),
      prisma.organization.count({ where: { ownerUserId: userId } }),
      prisma.ownerTeam.count({ where: { ownerUserId: userId } }),
    ]);
    if (contextCount > 0 || orgCount > 0 || ownedTeamsCount > 0) {
      return next();
    }
    return res.status(403).json({
      success: false,
      error: "No context or organization. Complete onboarding first.",
      needsOnboarding: true,
    });
  } catch (e) {
    console.error("[requireOwnerContext]", e);
    return res.status(500).json({ success: false, error: "Server error" });
  }
}

module.exports = { requireOwnerContext };
export {};
