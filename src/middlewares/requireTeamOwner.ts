/**
 * Restrict access to team-management routes to users who own at least one team
 * (OwnerTeam.ownerUserId = req.user.id). Delegates (team members) have no owned teams → 403.
 * ADMIN is allowed.
 */
import type { Request, Response, NextFunction } from "express";

const prisma = require("../infrastructure/db/prismaClient").default;

type RequestWithUser = Request & { user?: { id: number } };

export async function requireTeamOwner(req: RequestWithUser, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    const uid = Number(userId);
    const ownedCount = await prisma.ownerTeam.count({
      where: { ownerUserId: uid },
    });
    if (ownedCount > 0) {
      return next();
    }
    const allowIds = String(process.env.ADMIN_USER_IDS || "")
      .split(",")
      .map((x) => Number(x.trim()))
      .filter(Boolean);
    if (allowIds.includes(uid)) {
      return next();
    }
    return res.status(403).json({
      success: false,
      error: "Forbidden: team management is only available to team owners",
    });
  } catch (e) {
    console.error("[requireTeamOwner]", e);
    return res.status(500).json({ success: false, error: "Server error" });
  }
}

module.exports = { requireTeamOwner };
export {};
