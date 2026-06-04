/**
 * Campaign middleware — auth and staff RBAC (reuses BPA JWT + CampaignStaff roles).
 */

import type { Request, Response, NextFunction } from "express";
import {
  hasPermission as staffHasPermission,
  requirePermission as staffRequirePermission,
  validateLocationAccess,
} from "./staff.service";
import type { StaffPermissions } from "./campaign.types";

const authenticateToken = require("../../../../middleware/auth.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");
type StaffPermKey = keyof StaffPermissions;

function parsePositiveInt(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

async function resolveCampaignId(req: Request): Promise<number | undefined> {
  const fromParams =
    parsePositiveInt(req.params.campaignId) ??
    parsePositiveInt(req.params.id);
  if (fromParams) return fromParams;

  const body = req.body as Record<string, unknown>;
  const fromBody = parsePositiveInt(body?.campaignId);
  if (fromBody) return fromBody;

  const bookingId =
    parsePositiveInt(body?.bookingId) ?? parsePositiveInt(req.params.bookingId);
  if (bookingId) {
    const prisma = require("../../../../infrastructure/db/prismaClient").default;
    const booking = await prisma.campaignBooking.findUnique({
      where: { id: bookingId },
      select: { campaignId: true },
    });
    return booking?.campaignId;
  }

  const campaignPetId = parsePositiveInt(body?.campaignPetId);
  if (campaignPetId) {
    const prisma = require("../../../../infrastructure/db/prismaClient").default;
    const pet = await prisma.campaignPet.findUnique({
      where: { id: campaignPetId },
      select: { booking: { select: { campaignId: true } } },
    });
    return pet?.booking?.campaignId;
  }

  const locationId =
    parsePositiveInt(body?.locationId) ?? parsePositiveInt(req.params.locationId);
  if (locationId) {
    const prisma = require("../../../../infrastructure/db/prismaClient").default;
    const loc = await prisma.campaignLocation.findUnique({
      where: { id: locationId },
      select: { campaignId: true },
    });
    return loc?.campaignId;
  }

  return undefined;
}

/** BPA staff JWT required */
export const requireCampaignAuth = [
  authenticateToken,
  (req: Request, res: Response, next: NextFunction) => {
    if (!(req as any).user?.id) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Authentication required" },
      });
    }
    next();
  },
];

/** Platform admin with campaign.manage (or whitelisted admin.*) */
export const requireCampaignAdmin = [
  ...requireCampaignAuth,
  requirePermission("campaign.manage"),
];

/**
 * Campaign staff role permission (CampaignStaff table).
 * Optional locationId on request must match assignment when present.
 */
export function requireCampaignStaff(permission: StaffPermKey) {
  return [
    ...requireCampaignAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = (req as any).user?.id as number;
        const campaignId = await resolveCampaignId(req);

        if (!campaignId) {
          return res.status(400).json({
            success: false,
            error: { code: "CAMPAIGN_ID_REQUIRED", message: "campaignId is required" },
          });
        }

        const locationId =
          parsePositiveInt((req.body as any)?.locationId) ??
          parsePositiveInt(req.params.locationId);

        if (locationId) {
          await validateLocationAccess(userId, campaignId, locationId);
        }

        await staffRequirePermission(userId, campaignId, permission, locationId);

        (req as any).campaignId = campaignId;
        next();
      } catch (err) {
        next(err);
      }
    },
  ];
}

/** Admin OR campaign staff with permission */
export function requireCampaignAdminOrStaff(permission: StaffPermKey) {
  return [
    ...requireCampaignAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = (req as any).user?.id as number;
        const perms: string[] = (req as any).user?.permissions || [];
        const campaignId = await resolveCampaignId(req);

        if (
          (req as any).user?.isWhitelistedAdmin ||
          perms.includes("campaign.manage") ||
          perms.includes("global.admin")
        ) {
          if (campaignId) (req as any).campaignId = campaignId;
          return next();
        }

        if (!campaignId) {
          return res.status(400).json({
            success: false,
            error: { code: "CAMPAIGN_ID_REQUIRED", message: "campaignId is required" },
          });
        }

        const allowed = await staffHasPermission(userId, campaignId, permission);
        if (!allowed) {
          return res.status(403).json({
            success: false,
            error: { code: "STAFF_NOT_AUTHORIZED", message: "Staff does not have permission for this action" },
          });
        }

        (req as any).campaignId = campaignId;
        next();
      } catch (err) {
        next(err);
      }
    },
  ];
}
