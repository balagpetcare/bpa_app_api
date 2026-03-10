import type { Request, Response, NextFunction } from "express";
import prisma from "../../../../infrastructure/db/prismaClient";
import { getEffectivePermissions } from "../../services/permissions.service";
import {
  getActivePermissionsForUser,
  resolveBranchAccessProfile,
} from "../../services/branchAccessPermission.service";
import {
  createLocationEvent,
  setManualLocation,
  getLocation as getLocationFromService,
} from "./location.service";
import {
  validateLocationEventBody,
  validateLocationManualBody,
} from "./location.validators";
import { buildGeoKeys } from "./adGeoKeys.service";

function getAuthUserId(req: any): number | null {
  const id =
    req?.user?.id ??
    req?.userId ??
    req?.auth?.userId ??
    req?.authUser?.id ??
    req?.session?.user?.id;

  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function getMe(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // ✅ Keep select minimal to match your schema (avoid profile fields)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        status: true,

        // These may or may not exist; if they don't exist in your schema,
        // comment them out. Keeping them OUT avoids build errors.
        // phone: true,
        // email: true,
        // name: true,
        // role: true,
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // ✅ orgMembers - fixed: no Organization.verificationStatus
    const orgMembers = await prisma.orgMember.findMany({
      where: {
        userId,
        status: "ACTIVE",
      },
      select: {
        id: true,
        orgId: true,
        role: true,
        status: true,
        org: {
          select: {
            id: true,
            name: true,
            status: true, // ✅ exists (seen in prisma error output)
            ownerUserId: true,
            supportPhone: true,
            addressJson: true,
            createdAt: true,
            updatedAt: true,
            // legalProfile exists as relation (optional)
            legalProfile: true,
            _count: true,
          },
        },
      },
      orderBy: { id: "desc" },
    });

    // ✅ Optional compatibility: expose verificationStatus as org.status
    const normalizedOrgMembers = orgMembers.map((m: any) => ({
      ...m,
      org: m.org ? { ...m.org, verificationStatus: m.org.status } : null,
    }));

    // Branch access: resolved role + permissions per branch (APPROVED only)
    let branchAccess: { branchId: number; role: string; permissions: string[]; scopes: string[]; status: string }[] = [];
    try {
      const activePerms = await getActivePermissionsForUser(userId);
      const resolved = await Promise.all(
        activePerms.map(async (p: { branchId: number }) => {
          const profile = await resolveBranchAccessProfile(userId, p.branchId);
          return profile
            ? {
                branchId: p.branchId,
                role: profile.role,
                permissions: profile.permissions,
                scopes: profile.scopes,
                status: profile.status,
              }
            : null;
        })
      );
      branchAccess = resolved.filter((r): r is NonNullable<typeof r> => r !== null);
    } catch {
      // keep branchAccess [] if resolver fails
    }

    let roles: string[] = [];
    let permissions: string[] = Array.isArray((req as any)?.user?.permissions)
      ? (req as any).user.permissions.map((p: unknown) => String(p))
      : [];
    try {
      const countryCode = (req as any).countryContext?.countryCode as string | undefined;
      const stateId = (req as any).countryContext?.state?.stateId as number | undefined;
      const effective = await getEffectivePermissions(prisma, userId, countryCode, stateId);
      roles = (effective.roles || []).map((r) => String(r.key)).filter(Boolean);
      if (permissions.length === 0) {
        permissions = (effective.permissions || []).map((p) => String(p.key)).filter(Boolean);
      }
    } catch {
      // keep fallback from req.user.permissions
    }

    return res.json({
      success: true,
      data: {
        user,
        orgMembers: normalizedOrgMembers,
        branchAccess,
        roles,
        permissions,
      },
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/me/notifications
 * Returns unread notifications for the authenticated user
 */
export async function getNotifications(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const notifications = await prisma.notification.findMany({
      where: {
        userId,
        readAt: null, // Only unread notifications
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 50, // Limit to 50 most recent
    });

    return res.json({
      success: true,
      data: notifications,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/v1/me/notifications/:notificationId/accept-invite
 * Accepts a staff invitation from a notification
 */
export async function acceptInviteFromNotification(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);
    const notificationId = Number(req.params.notificationId);

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (!notificationId || !Number.isFinite(notificationId)) {
      return res.status(400).json({ success: false, message: "Invalid notification ID" });
    }

    // Verify notification belongs to user and is STAFF_INVITE type
    const notification = await prisma.notification.findFirst({
      where: {
        id: notificationId,
        userId,
        type: "STAFF_INVITE",
      },
    });

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    const meta = notification.meta as any;
    const inviteId = meta?.inviteId;

    if (!inviteId) {
      return res.status(400).json({ success: false, message: "Invalid notification data" });
    }

    // Find and verify the invite
    const invite = await prisma.staffInvite.findUnique({
      where: { id: Number(inviteId) },
      include: {
        branch: { select: { id: true, orgId: true, name: true } },
        org: { select: { id: true, name: true } },
      },
    });

    if (!invite) {
      return res.status(404).json({ success: false, message: "Invitation not found" });
    }

    if (invite.status !== "PENDING") {
      return res.status(400).json({ success: false, message: `Invite is not pending (${invite.status})` });
    }

    // Check if invite is expired
    if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
      await prisma.staffInvite.update({ where: { id: invite.id }, data: { status: "EXPIRED" } });
      return res.status(400).json({ success: false, message: "Invite expired" });
    }

    // Check if user is already a member of this branch
    const existingMember = await prisma.branchMember.findUnique({
      where: {
        branchId_userId: {
          branchId: invite.branchId,
          userId: userId,
        },
      },
    });

    if (existingMember && existingMember.status === "ACTIVE") {
      // User is already a member, just mark invite and notification as handled
      await prisma.$transaction([
        prisma.staffInvite.update({
          where: { id: invite.id },
          data: { status: "ACCEPTED", acceptedByUserId: userId },
        }),
        prisma.notification.update({
          where: { id: notificationId },
          data: { readAt: new Date() },
        }),
      ]);

      return res.json({
        success: true,
        message: "You are already a member of this branch",
        data: {
          branchId: invite.branchId,
          branchName: invite.branch?.name,
          role: invite.role,
        },
      });
    }

    // Create or update BranchMember, and ClinicStaffProfile when inviteAsDoctor
    const member = await prisma.$transaction(async (tx) => {
      const m = await (tx as any).branchMember.upsert({
        where: { branchId_userId: { branchId: invite.branchId, userId: userId } },
        update: { role: invite.role, status: "ACTIVE" },
        create: {
          orgId: invite.orgId,
          branchId: invite.branchId,
          userId: userId,
          role: invite.role,
          status: "ACTIVE",
          invitedByUserId: invite.invitedByUserId,
        },
        select: { id: true },
      });

      if ((invite as any).inviteAsDoctor) {
        const branchWithTypes = await (tx as any).branch.findUnique({
          where: { id: invite.branchId },
          select: { types: { select: { type: { select: { code: true } } } } },
        });
        const isClinic = branchWithTypes?.types?.some(
          (t: any) => String(t?.type?.code || "").toUpperCase() === "CLINIC"
        );
        if (isClinic) {
          await (tx as any).clinicStaffProfile.upsert({
            where: { branchMemberId: m.id },
            create: {
              orgId: invite.orgId,
              branchId: invite.branchId,
              branchMemberId: m.id,
              staffType: "DOCTOR",
              status: "ACTIVE",
              onboardingStatus: "PENDING",
            },
            update: { staffType: "DOCTOR", status: "ACTIVE", onboardingStatus: "PENDING" },
          });
        }
      }

      await (tx as any).staffInvite.update({
        where: { id: invite.id },
        data: { status: "ACCEPTED", acceptedByUserId: userId },
      });
      await (tx as any).notification.update({
        where: { id: notificationId },
        data: { readAt: new Date() },
      });

      return m;
    });

    const responseData: any = {
      branchId: invite.branchId,
      branchName: invite.branch?.name,
      orgId: invite.orgId,
      orgName: invite.org?.name,
      role: invite.role,
    };
    if ((invite as any).inviteAsDoctor) {
      const profile = await prisma.clinicStaffProfile.findFirst({
        where: { branchMemberId: member.id, staffType: "DOCTOR" },
        select: { onboardingStatus: true },
      });
      if (profile?.onboardingStatus === "PENDING") {
        responseData.onboardingRequired = true;
        responseData.onboardingPath = `/doctor/onboarding/${invite.branchId}`;
      }
    }

    return res.json({
      success: true,
      message: "Invitation accepted successfully",
      data: responseData,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/v1/me/notifications/:notificationId/decline-invite
 * Declines a staff invitation from a notification
 */
export async function declineInviteFromNotification(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);
    const notificationId = Number(req.params.notificationId);

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (!notificationId || !Number.isFinite(notificationId)) {
      return res.status(400).json({ success: false, message: "Invalid notification ID" });
    }

    // Verify notification belongs to user and is STAFF_INVITE type
    const notification = await prisma.notification.findFirst({
      where: {
        id: notificationId,
        userId,
        type: "STAFF_INVITE",
      },
    });

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    // Mark notification as read (keep invite as PENDING for potential future acceptance)
    await prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });

    return res.json({
      success: true,
      message: "Invitation declined",
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/me/permissions
 * Phase 4: Effective permissions (scope + action) for current user.
 * Uses country from req.countryContext for country-scoped roles.
 */
export async function getPermissions(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const countryCode = (req as any).countryContext?.countryCode as string | undefined;
    const stateId = (req as any).countryContext?.state?.stateId as number | undefined;
    const result = await getEffectivePermissions(prisma, userId, countryCode, stateId);
    return res.json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/me/location
 * Returns { profile, currentPlace, homePlace, manualOverridePlace, events, geoKeys }.
 * geoKeys include country, admin1, city, postal, geohash, home (manual override wins, else inferred from 30d), recently_in (most frequent city/admin1 from 7d).
 */
export async function getLocation(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const data = await getLocationFromService(prisma, userId);
    const effectiveHome = data.manualOverridePlace ?? data.inferredHomePlace ?? data.homePlace;
    const geoKeys = buildGeoKeys({
      profile: data.profile,
      currentPlace: data.currentPlace,
      homePlace: effectiveHome,
      recentlyIn: data.recentlyIn ?? undefined,
    });
    return res.json({ success: true, data: { ...data, geoKeys } });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/v1/me/location/events
 * Create UserLocationEvent, update UserLocationProfile (lastLat/lastLng, currentPlaceId if resolvable).
 */
export async function postLocationEvents(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const parsed = validateLocationEventBody(req.body);
    if (parsed.ok === false) {
      return res.status(400).json({ success: false, message: parsed.message });
    }
    const { eventId } = await createLocationEvent(prisma, userId, parsed.data);
    return res.status(201).json({ success: true, data: { eventId } });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/v1/me/location/manual
 * Upsert LocationPlace, set manualOverridePlaceId + currentPlaceId, create MANUAL_SET event.
 */
export async function postLocationManual(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const parsed = validateLocationManualBody(req.body);
    if (parsed.ok === false) {
      return res.status(400).json({ success: false, message: parsed.message });
    }
    const { placeId } = await setManualLocation(prisma, userId, parsed.data);
    return res.status(201).json({ success: true, data: { placeId } });
  } catch (err) {
    return next(err);
  }
}

/**
 * PUT /api/v1/me/location
 * Set current user's saved place (Place shape). Creates Place if needed.
 */
export async function setLocation(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const body = req.body || {};
    const lat = Number(body.latitude);
    const lng = Number(body.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ success: false, message: "latitude and longitude are required" });
    }
    const newPlace = await prisma.place.create({
      data: {
        latitude: lat,
        longitude: lng,
        countryCode: body.countryCode ? String(body.countryCode).trim().slice(0, 2) : null,
        stateName: body.stateName ? String(body.stateName).slice(0, 255) : null,
        cityName: body.cityName ? String(body.cityName).slice(0, 255) : null,
        formattedAddress: body.formattedAddress ? String(body.formattedAddress).slice(0, 1024) : null,
      },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { currentPlaceId: newPlace.id },
    });
    const updated = await prisma.place.findUnique({
      where: { id: newPlace.id },
      select: {
        latitude: true,
        longitude: true,
        countryCode: true,
        stateName: true,
        cityName: true,
        formattedAddress: true,
        updatedAt: true,
      },
    });
    return res.json({
      success: true,
      data: updated
        ? {
            latitude: updated.latitude,
            longitude: updated.longitude,
            countryCode: updated.countryCode ?? null,
            stateName: updated.stateName ?? null,
            cityName: updated.cityName ?? null,
            formattedAddress: updated.formattedAddress ?? null,
            updatedAt: updated.updatedAt,
          }
        : null,
    });
  } catch (err) {
    return next(err);
  }
}

export async function getContexts(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const userContextService = require("../../services/userContext.service");
    const contexts = await userContextService.listContexts(userId);
    return res.status(200).json({ success: true, data: contexts });
  } catch (e) {
    return next(e);
  }
}

export async function setDefaultContext(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const contextId = Number((req as any).params?.id);
    if (!Number.isFinite(contextId)) return res.status(400).json({ success: false, message: "Invalid context id" });
    const userContextService = require("../../services/userContext.service");
    const context = await userContextService.setDefaultContext(userId, contextId);
    return res.status(200).json({ success: true, data: context });
  } catch (e: any) {
    if (e?.message === "Context not found") return res.status(404).json({ success: false, message: e.message });
    return next(e);
  }
}

export default getMe;

// CommonJS compatibility for require("./me.controller")
(module as any).exports = {
  getMe,
  getNotifications,
  acceptInviteFromNotification,
  declineInviteFromNotification,
  getPermissions,
  getLocation,
  setLocation,
  postLocationEvents,
  postLocationManual,
  getContexts,
  setDefaultContext,
};
