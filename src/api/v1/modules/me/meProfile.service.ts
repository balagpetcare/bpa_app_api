/**
 * Enterprise "me" profile aggregation + mutations (self-service).
 * Source of truth remains Prisma models; RBAC editing is out of scope here.
 */

import type { Request } from "express";
import bcrypt from "bcrypt";
import { Gender, Prisma, UserStatus, AuditEntityType } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";
import { getEffectivePermissions } from "../../services/permissions.service";
import {
  getActivePermissionsForUser,
  resolveBranchAccessProfile,
} from "../../services/branchAccessPermission.service";
import { computeEffectivePhotoParts } from "../../services/providerProfileBootstrap.service";
import { isAllowedProfilePhotoMime } from "./profilePhotoUpload.config";

const { writeAudit } = require("../../../../middlewares/auditWriter");
const centralizedLocationService = require("../../../../modules/location/location.service");
const { asIntOrNull } = require("../../../../modules/location/location.validators");

function getUserId(req: Request): number | null {
  const id = (req as any)?.user?.id ?? (req as any)?.userId;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Returns null if mutations are allowed; otherwise an HTTP-style error payload. */
export async function assertCanMutate(
  userId: number
): Promise<{ status: number; message: string } | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!u) return { status: 404, message: "User not found" };
  if (u.status !== UserStatus.ACTIVE) {
    return { status: 403, message: "Account cannot be modified in the current state" };
  }
  return null;
}

function parseGender(v: unknown): Gender | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const s = String(v).toUpperCase().trim();
  if (s === "MALE" || s === "FEMALE" || s === "UNKNOWN") return s as Gender;
  return undefined;
}

function parseJsonObject(v: unknown): Prisma.InputJsonValue | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "object" && !Array.isArray(v)) return v as Prisma.InputJsonValue;
  return undefined;
}

/** Reused by PATCH /api/v1/me/profile and legacy PATCH /api/v1/user/me */
export async function resolveUserProfileLocationUpdate(
  body: Record<string, unknown>
): Promise<
  | { ok: true; data: { divisionId: number | null; districtId: number | null; upazilaId: number | null; unionId: number | null; areaId: number | null } }
  | { ok: false; message: string }
  | { ok: true; data: null; skip: true }
> {
  const loc =
    typeof body.location === "object" && body.location && !Array.isArray(body.location)
      ? (body.location as Record<string, unknown>)
      : body;
  const hasAny =
    loc.divisionId !== undefined ||
    loc.districtId !== undefined ||
    loc.upazilaId !== undefined ||
    loc.unionId !== undefined ||
    loc.areaId !== undefined ||
    loc.bdAreaId !== undefined;
  if (!hasAny) return { ok: true, data: null, skip: true };

  const selection = {
    divisionId: asIntOrNull(loc.divisionId),
    districtId: asIntOrNull(loc.districtId),
    upazilaId: asIntOrNull(loc.upazilaId),
    unionId: asIntOrNull(loc.unionId),
    areaId: asIntOrNull(loc.areaId ?? loc.bdAreaId),
  };
  const allNull =
    selection.divisionId === null &&
    selection.districtId === null &&
    selection.upazilaId === null &&
    selection.unionId === null &&
    selection.areaId === null;
  if (allNull) {
    return { ok: true, data: { divisionId: null, districtId: null, upazilaId: null, unionId: null, areaId: null } };
  }
  const validated = await centralizedLocationService.validateSelection(prisma, selection);
  if (!validated?.ok) {
    return { ok: false, message: validated?.message || "Invalid location selection" };
  }
  const n = validated.normalized || selection;
  return {
    ok: true,
    data: {
      divisionId: n.divisionId ?? null,
      districtId: n.districtId ?? null,
      upazilaId: n.upazilaId ?? null,
      unionId: n.unionId ?? null,
      areaId: n.areaId ?? null,
    },
  };
}

export async function getEnterpriseProfile(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      auth: {
        select: {
          provider: true,
          email: true,
          phone: true,
          lastLoginAt: true,
          passwordUpdatedAt: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
        },
      },
      profile: {
        include: {
          avatarMedia: { select: { id: true, url: true } },
          coverMedia: { select: { id: true, url: true } },
        },
      },
      appSettings: true,
      notificationPrefs: true,
      ownerProfile: {
        select: {
          id: true,
          name: true,
          supportPhone: true,
          supportEmail: true,
          createdAt: true,
        },
      },
    },
  });

  if (!user) return null;

  const [orgMembers, doctorVerification, branchMembers] = await Promise.all([
    prisma.orgMember.findMany({
      where: { userId, status: "ACTIVE" },
      select: {
        id: true,
        role: true,
        status: true,
        org: { select: { id: true, name: true, status: true } },
      },
    }),
    prisma.doctorVerification.findUnique({
      where: { userId },
      select: {
        verificationStatus: true,
        licenseNumber: true,
        specializationTags: true,
        qualifications: true,
        primaryCountryCode: true,
      },
    }),
    prisma.branchMember.findMany({
      where: { userId, status: "ACTIVE" },
      include: {
        branch: { select: { id: true, name: true, code: true, status: true, orgId: true } },
        org: { select: { id: true, name: true } },
        roles: { include: { role: { select: { key: true, label: true, scope: true } } } },
        clinicStaffProfile: {
          select: {
            staffType: true,
            licenseNumber: true,
            specializationTags: true,
            roleInClinic: true,
            visitTypes: true,
            defaultConsultationFee: true,
            followUpFee: true,
            emergencyFee: true,
            commissionPolicy: true,
            contractStatus: true,
            allowEmergencyOverbook: true,
            visiting: true,
            status: true,
            onboardingStatus: true,
          },
        },
      },
      orderBy: { id: "desc" },
    }),
  ]);

  const activeBranchId = user.appSettings?.lastActiveBranchId ?? null;

  const eff = computeEffectivePhotoParts(user.profile as any);

  return {
    user: {
      id: user.id,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      authProvider: user.auth?.provider ?? null,
    },
    basic: {
      fullName: user.profile?.displayName ?? null,
      displayName: user.profile?.displayName ?? null,
      username: user.profile?.username ?? null,
      bio: user.profile?.bio ?? null,
      providerDisplayName: (user.profile as any)?.providerDisplayName ?? null,
      manualPhotoUrl: eff.manualPhotoUrl,
      providerPhotoUrl: eff.providerPhotoUrl,
      effectivePhotoUrl: eff.effectivePhotoUrl,
      photoSource: eff.photoSource,
      profilePhoto: user.profile?.avatarMedia
        ? { id: user.profile.avatarMedia.id, url: user.profile.avatarMedia.url }
        : null,
      coverPhoto: user.profile?.coverMedia
        ? { id: user.profile.coverMedia.id, url: user.profile.coverMedia.url }
        : null,
      phone: user.auth?.phone ?? null,
      email: user.auth?.email ?? null,
      gender: user.profile?.gender ?? null,
      dateOfBirth: user.profile?.dateOfBirth ?? null,
      address: user.profile?.addressJson ?? null,
      location: {
        divisionId: (user.profile as any)?.divisionId ?? null,
        districtId: (user.profile as any)?.districtId ?? null,
        upazilaId: (user.profile as any)?.upazilaId ?? null,
        unionId: (user.profile as any)?.unionId ?? null,
        areaId: (user.profile as any)?.areaId ?? null,
      },
      emergencyContact: user.profile?.emergencyContactJson ?? null,
      visibility: user.profile?.visibility ?? null,
      showEmail: user.profile?.showEmail ?? false,
      showPhone: user.profile?.showPhone ?? false,
    },
    organization: {
      owner: user.ownerProfile,
      orgMembers,
      doctorVerification,
    },
    professional: {
      branchAssignments: branchMembers.map((bm) => ({
        branchMemberId: bm.id,
        branchId: bm.branchId,
        orgId: bm.orgId,
        primaryRole: bm.role,
        branch: bm.branch,
        org: bm.org,
        rbacRoles: (bm.roles || []).map((r) => ({
          key: r.role.key,
          label: r.role.label,
          scope: r.role.scope,
        })),
        clinic: bm.clinicStaffProfile
          ? {
              ...bm.clinicStaffProfile,
              defaultConsultationFee:
                bm.clinicStaffProfile.defaultConsultationFee != null
                  ? Number(bm.clinicStaffProfile.defaultConsultationFee)
                  : null,
              followUpFee:
                bm.clinicStaffProfile.followUpFee != null ? Number(bm.clinicStaffProfile.followUpFee) : null,
              emergencyFee:
                bm.clinicStaffProfile.emergencyFee != null ? Number(bm.clinicStaffProfile.emergencyFee) : null,
              employeeCode: bm.clinicStaffProfile.licenseNumber ?? `BM-${bm.id}`,
            }
          : null,
      })),
    },
    preferences: {
      app: user.appSettings
        ? {
            language: user.appSettings.language,
            theme: user.appSettings.theme,
            timezone: user.appSettings.timezone,
            dashboardLanding: user.appSettings.dashboardLanding,
            lastActiveBranchId: user.appSettings.lastActiveBranchId,
          }
        : null,
      notifications: user.notificationPrefs
        ? {
            allowEmail: user.notificationPrefs.allowEmail,
            allowSms: user.notificationPrefs.allowSms,
            allowInApp: user.notificationPrefs.allowInApp,
            soundEnabled: user.notificationPrefs.soundEnabled,
            quietHoursStart: user.notificationPrefs.quietHoursStart,
            quietHoursEnd: user.notificationPrefs.quietHoursEnd,
            enabledTypes: user.notificationPrefs.enabledTypes,
          }
        : null,
    },
    workspace: {
      activeBranchId,
    },
  };
}

export async function patchEnterpriseProfile(req: Request, userId: number, body: Record<string, unknown>) {
  const gate = await assertCanMutate(userId);
  if (gate) return { ok: false as const, status: gate.status, message: gate.message };

  if (
    body.providerAvatarUrl !== undefined ||
    body.providerDisplayName !== undefined ||
    body.providerKey !== undefined ||
    body.providerSyncedAt !== undefined
  ) {
    return {
      ok: false as const,
      status: 400,
      message: "Provider snapshot fields cannot be changed via this endpoint",
    };
  }

  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      profile: {
        select: {
          displayName: true,
          bio: true,
          username: true,
          visibility: true,
          showEmail: true,
          showPhone: true,
          avatarMediaId: true,
          gender: true,
          dateOfBirth: true,
          addressJson: true,
          emergencyContactJson: true,
          divisionId: true,
          districtId: true,
          upazilaId: true,
          unionId: true,
          areaId: true,
        },
      },
      auth: { select: { email: true, phone: true } },
    },
  });

  const {
    displayName,
    username,
    bio,
    visibility,
    showEmail,
    showPhone,
    avatarMediaId,
    coverMediaId,
    email,
    phone,
    gender,
    dateOfBirth,
    address,
    emergencyContact,
  } = body || {};

  const locationResolved = await resolveUserProfileLocationUpdate(body);
  if (locationResolved.ok === false) {
    return { ok: false as const, status: 400, message: locationResolved.message };
  }

  const profileData: Prisma.UserProfileUpdateInput = {};
  const authData: Prisma.UserAuthUpdateInput = {};

  if (displayName !== undefined) {
    const dn = String(displayName).trim();
    if (dn.length < 1) return { ok: false as const, status: 400, message: "displayName cannot be empty" };
    profileData.displayName = dn.slice(0, 200);
  }
  if (username !== undefined) profileData.username = String(username).trim().slice(0, 30);
  if (bio !== undefined) profileData.bio = (bio === null ? null : String(bio).slice(0, 8000)) as any;
  if (visibility !== undefined) {
    const v = String(visibility || "").trim().toUpperCase();
    if (!["PUBLIC", "PRIVATE", "FOLLOWERS_ONLY"].includes(v)) {
      return { ok: false as const, status: 400, message: "Invalid visibility" };
    }
    profileData.visibility = v as any;
  }
  if (showEmail !== undefined) profileData.showEmail = Boolean(showEmail);
  if (showPhone !== undefined) profileData.showPhone = Boolean(showPhone);

  const g = parseGender(gender);
  if (gender !== undefined && g === undefined) {
    return { ok: false as const, status: 400, message: "Invalid gender" };
  }
  if (g !== undefined) profileData.gender = g;

  if (dateOfBirth !== undefined) {
    if (dateOfBirth === null || dateOfBirth === "") {
      profileData.dateOfBirth = null;
    } else {
      const d = new Date(String(dateOfBirth));
      if (Number.isNaN(d.getTime())) return { ok: false as const, status: 400, message: "Invalid dateOfBirth" };
      profileData.dateOfBirth = d;
    }
  }

  const addr = parseJsonObject(address);
  if (address !== undefined && addr === undefined && address !== null) {
    return { ok: false as const, status: 400, message: "address must be a JSON object" };
  }
  if (addr !== undefined) profileData.addressJson = addr as any;

  const em = parseJsonObject(emergencyContact);
  if (emergencyContact !== undefined && em === undefined && emergencyContact !== null) {
    return { ok: false as const, status: 400, message: "emergencyContact must be a JSON object" };
  }
  if (em !== undefined) profileData.emergencyContactJson = em as any;

  if (locationResolved.ok && locationResolved.data && !("skip" in locationResolved)) {
    profileData.divisionId = locationResolved.data.divisionId;
    profileData.districtId = locationResolved.data.districtId;
    profileData.upazilaId = locationResolved.data.upazilaId;
    profileData.unionId = locationResolved.data.unionId;
    profileData.areaId = locationResolved.data.areaId;
  }

  const aIdRaw = avatarMediaId;
  const cIdRaw = coverMediaId;
  const aId =
    aIdRaw === undefined ? undefined : aIdRaw === null || aIdRaw === "" ? null : Number(aIdRaw);
  const cId =
    cIdRaw === undefined ? undefined : cIdRaw === null || cIdRaw === "" ? null : Number(cIdRaw);
  if (aId !== undefined) {
    profileData.avatarMedia = aId === null ? { disconnect: true } : { connect: { id: aId } };
  }
  if (cId !== undefined) {
    profileData.coverMedia = cId === null ? { disconnect: true } : { connect: { id: cId } };
  }

  if (email !== undefined) authData.email = email === null ? null : String(email).trim().toLowerCase() || null;
  if (phone !== undefined) authData.phone = phone === null ? null : String(phone).replace(/\D/g, "") || null;

  if (
    Object.keys(profileData).length === 0 &&
    Object.keys(authData).length === 0
  ) {
    return { ok: true as const, data: await getEnterpriseProfile(userId), audit: null };
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(Object.keys(profileData).length ? { profile: { update: profileData } } : {}),
        ...(Object.keys(authData).length ? { auth: { update: authData } } : {}),
      },
    });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return { ok: false as const, status: 409, message: "Username or email already in use" };
    }
    throw e;
  }

  const after = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      profile: { select: { avatarMediaId: true } },
    },
  });

  const photoChanged =
    aId !== undefined && Number(before?.profile?.avatarMediaId || 0) !== Number(after?.profile?.avatarMediaId || 0);

  await writeAudit({
    prisma,
    req,
    action: photoChanged ? "PROFILE_PHOTO_UPDATED" : "PROFILE_UPDATED",
    entityType: AuditEntityType.USER,
    entityId: String(userId),
    before: before ?? null,
    after: {
      profile: profileData,
      auth: authData,
    },
  });

  return { ok: true as const, data: await getEnterpriseProfile(userId), audit: true };
}

export async function getSettings(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { appSettings: true, notificationPrefs: true },
  });
  if (!user) return null;
  return {
    app: user.appSettings,
    notifications: user.notificationPrefs,
  };
}

export async function patchSettings(req: Request, userId: number, body: Record<string, unknown>) {
  const gate = await assertCanMutate(userId);
  if (gate) return { ok: false as const, status: gate.status, message: gate.message };

  const appIn: Record<string, unknown> = {
    ...((typeof body.app === "object" && body.app && !Array.isArray(body.app) ? body.app : {}) as Record<string, unknown>),
    ...((typeof body.appSettings === "object" && body.appSettings && !Array.isArray(body.appSettings)
      ? body.appSettings
      : {}) as Record<string, unknown>),
  };
  if (body.language !== undefined) appIn.language = body.language;
  if (body.theme !== undefined) appIn.theme = body.theme;
  if (body.timezone !== undefined) appIn.timezone = body.timezone;
  if (body.dashboardLanding !== undefined) appIn.dashboardLanding = body.dashboardLanding;

  const notifIn: Record<string, unknown> = {
    ...((typeof body.notifications === "object" && body.notifications && !Array.isArray(body.notifications)
      ? body.notifications
      : {}) as Record<string, unknown>),
    ...((typeof body.notificationPrefs === "object" && body.notificationPrefs && !Array.isArray(body.notificationPrefs)
      ? body.notificationPrefs
      : {}) as Record<string, unknown>),
  };
  if (body.allowEmail !== undefined) notifIn.allowEmail = body.allowEmail;
  if (body.allowSms !== undefined) notifIn.allowSms = body.allowSms;
  if (body.allowInApp !== undefined) notifIn.allowInApp = body.allowInApp;
  if (body.soundEnabled !== undefined) notifIn.soundEnabled = body.soundEnabled;

  let appUpdate: Prisma.UserAppSettingsUpdateInput = {};

  if (appIn.language !== undefined) appUpdate.language = appIn.language == null ? null : String(appIn.language).slice(0, 32);
  if (appIn.theme !== undefined) appUpdate.theme = appIn.theme == null ? null : String(appIn.theme).slice(0, 32);
  if (appIn.timezone !== undefined) appUpdate.timezone = appIn.timezone == null ? null : String(appIn.timezone).slice(0, 64);
  if (appIn.dashboardLanding !== undefined) {
    appUpdate.dashboardLanding = appIn.dashboardLanding == null ? null : String(appIn.dashboardLanding).slice(0, 256);
  }

  const notifUpsert: Prisma.UserNotificationPrefsCreateInput = {
    user: { connect: { id: userId } },
    allowEmail: true,
    allowSms: false,
    allowInApp: true,
    soundEnabled: true,
  };
  const notifUpdate: Prisma.UserNotificationPrefsUpdateInput = {};
  if (notifIn.allowEmail !== undefined) notifUpdate.allowEmail = Boolean(notifIn.allowEmail);
  if (notifIn.allowSms !== undefined) notifUpdate.allowSms = Boolean(notifIn.allowSms);
  if (notifIn.allowInApp !== undefined) notifUpdate.allowInApp = Boolean(notifIn.allowInApp);
  if (notifIn.soundEnabled !== undefined) notifUpdate.soundEnabled = Boolean(notifIn.soundEnabled);
  if (notifIn.quietHoursStart !== undefined) {
    notifUpdate.quietHoursStart =
      notifIn.quietHoursStart === null ? null : Math.min(1439, Math.max(0, Number(notifIn.quietHoursStart)));
  }
  if (notifIn.quietHoursEnd !== undefined) {
    notifUpdate.quietHoursEnd =
      notifIn.quietHoursEnd === null ? null : Math.min(1439, Math.max(0, Number(notifIn.quietHoursEnd)));
  }
  if (notifIn.enabledTypes !== undefined) {
    notifUpdate.enabledTypes = notifIn.enabledTypes === null ? Prisma.JsonNull : (notifIn.enabledTypes as any);
  }

  if (Object.keys(appUpdate).length === 0 && Object.keys(notifUpdate).length === 0) {
    return { ok: true as const, data: await getSettings(userId) };
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(appUpdate).length > 0) {
      await tx.userAppSettings.upsert({
        where: { userId },
        create: {
          userId,
          language: (appUpdate.language as string | null | undefined) ?? null,
          theme: (appUpdate.theme as string | null | undefined) ?? null,
          timezone: (appUpdate.timezone as string | null | undefined) ?? null,
          dashboardLanding: (appUpdate.dashboardLanding as string | null | undefined) ?? null,
        },
        update: appUpdate,
      });
    }
    if (Object.keys(notifUpdate).length > 0) {
      await tx.userNotificationPrefs.upsert({
        where: { userId },
        create: { ...notifUpsert, ...notifUpdate } as any,
        update: notifUpdate,
      });
    }
  });

  if (Object.keys(appUpdate).length > 0) {
    await writeAudit({
      prisma,
      req,
      action: "USER_PREFERENCES_UPDATED",
      entityType: AuditEntityType.USER,
      entityId: String(userId),
      before: null,
      after: { app: appUpdate },
    });
  }
  if (Object.keys(notifUpdate).length > 0) {
    await writeAudit({
      prisma,
      req,
      action: "USER_NOTIFICATION_PREFS_UPDATED",
      entityType: AuditEntityType.USER,
      entityId: String(userId),
      before: null,
      after: { notifications: notifUpdate },
    });
  }

  return { ok: true as const, data: await getSettings(userId) };
}

export async function getSecurityInfo(userId: number) {
  const auth = await prisma.userAuth.findUnique({
    where: { userId },
    select: {
      lastLoginAt: true,
      passwordUpdatedAt: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      provider: true,
    },
  });
  const sessionCount = await prisma.userSession.count({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
  });
  return {
    lastLoginAt: auth?.lastLoginAt ?? null,
    passwordUpdatedAt: auth?.passwordUpdatedAt ?? null,
    emailVerifiedAt: auth?.emailVerifiedAt ?? null,
    phoneVerifiedAt: auth?.phoneVerifiedAt ?? null,
    authProvider: auth?.provider ?? null,
    activeSessionCount: sessionCount,
    otpReady: false,
    recoveryNote: "Use registered email or phone with support if you lose access.",
  };
}

export async function changePassword(req: Request, userId: number, body: Record<string, unknown>) {
  const gate = await assertCanMutate(userId);
  if (gate) return { ok: false as const, status: gate.status, message: gate.message };

  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");
  if (currentPassword.length < 4 || newPassword.length < 4) {
    return { ok: false as const, status: 400, message: "currentPassword and newPassword are required (min 4 chars)" };
  }

  const auth = await prisma.userAuth.findUnique({
    where: { userId },
    select: { passwordHash: true, provider: true },
  });
  if (!auth?.passwordHash) {
    return { ok: false as const, status: 400, message: "Password login is not enabled for this account" };
  }
  const ok = await bcrypt.compare(currentPassword, auth.passwordHash);
  if (!ok) return { ok: false as const, status: 401, message: "Current password is incorrect" };

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.userAuth.update({
    where: { userId },
    data: { passwordHash, passwordUpdatedAt: new Date() },
  });
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });

  await writeAudit({
    prisma,
    req,
    action: "PASSWORD_CHANGED",
    entityType: AuditEntityType.USER,
    entityId: String(userId),
    before: null,
    after: { passwordUpdated: true },
  });

  return { ok: true as const, data: { success: true } };
}

export async function getCapabilities(req: Request, userId: number) {
  const countryCode = (req as any).countryContext?.countryCode as string | undefined;
  const stateId = (req as any).countryContext?.state?.stateId as number | undefined;
  const eff = await getEffectivePermissions(prisma, userId, countryCode, stateId);

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
    branchAccess = [];
  }

  return {
    permissions: (eff.permissions || []).map((p) => p.key),
    roles: eff.roles || [],
    branchAccess,
  };
}

export async function getBranches(userId: number) {
  const rows = await prisma.branchMember.findMany({
    where: { userId, status: "ACTIVE" },
    include: {
      branch: { select: { id: true, name: true, code: true, status: true } },
      org: { select: { id: true, name: true } },
      roles: { include: { role: { select: { key: true, label: true } } } },
    },
    orderBy: { id: "desc" },
  });
  const app = await prisma.userAppSettings.findUnique({
    where: { userId },
    select: { lastActiveBranchId: true },
  });
  return {
    activeBranchId: app?.lastActiveBranchId ?? null,
    memberships: rows.map((r) => ({
      branchMemberId: r.id,
      branchId: r.branchId,
      orgId: r.orgId,
      memberRole: r.role,
      branch: r.branch,
      org: r.org,
      rbacRoles: (r.roles || []).map((x) => ({ key: x.role.key, label: x.role.label })),
    })),
  };
}

export async function patchActiveBranch(req: Request, userId: number, body: Record<string, unknown>) {
  const gate = await assertCanMutate(userId);
  if (gate) return { ok: false as const, status: gate.status, message: gate.message };

  const branchId = Number(body.branchId);
  if (!Number.isFinite(branchId)) return { ok: false as const, status: 400, message: "branchId is required" };

  const m = await prisma.branchMember.findFirst({
    where: { userId, branchId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!m) return { ok: false as const, status: 403, message: "Not a member of this branch" };

  await prisma.userAppSettings.upsert({
    where: { userId },
    create: { userId, lastActiveBranchId: branchId },
    update: { lastActiveBranchId: branchId },
  });

  await writeAudit({
    prisma,
    req,
    action: "ACTIVE_BRANCH_CHANGED",
    entityType: AuditEntityType.USER,
    entityId: String(userId),
    before: null,
    after: { branchId },
  });

  return { ok: true as const, data: await getBranches(userId) };
}

export async function uploadProfilePhoto(req: Request, userId: number) {
  const gate = await assertCanMutate(userId);
  if (gate) return { ok: false as const, status: gate.status, message: gate.message };

  const file = (req as any).file as
    | { buffer?: Buffer; mimetype?: string; originalname?: string; size?: number }
    | undefined;

  if (!file?.buffer) {
    return {
      ok: false as const,
      status: 400,
      message: "Choose an image file to upload (form field: file).",
      code: "FILE_REQUIRED",
    };
  }

  if (file.buffer.length === 0) {
    return {
      ok: false as const,
      status: 400,
      message: "The selected file is empty.",
      code: "FILE_REQUIRED",
    };
  }

  if (!isAllowedProfilePhotoMime(file.mimetype)) {
    return {
      ok: false as const,
      status: 400,
      message: "Profile image must be JPG, PNG, or WEBP.",
      code: "INVALID_FILE_TYPE",
    };
  }

  const { optimizeProfilePhotoFile } = require("../media/media.processor");
  const mediaService = require("../media/media.service");

  try {
    const processed = await optimizeProfilePhotoFile(file);

    const media = await mediaService.uploadAndCreateMedia({
      ownerUserId: userId,
      file: processed,
      folder: "avatars",
      countryCode: (req as any).countryContext?.countryCode,
    });

    const before = await prisma.userProfile.findUnique({
      where: { userId },
      select: { avatarMediaId: true },
    });

    await prisma.user.update({
      where: { id: userId },
      data: {
        profile: {
          update: {
            avatarMedia: { connect: { id: media.id } },
          },
        },
      },
    });

    const prevId = before?.avatarMediaId != null ? Number(before.avatarMediaId) : null;
    if (prevId && prevId !== Number(media.id)) {
      try {
        await mediaService.deleteMyMedia({ ownerUserId: userId, mediaId: prevId });
      } catch {
        // Non-fatal: old object may already be gone or cleanup unsupported
      }
    }

    await writeAudit({
      prisma,
      req,
      action: "PROFILE_PHOTO_UPDATED",
      entityType: AuditEntityType.USER,
      entityId: String(userId),
      before: before ?? null,
      after: { avatarMediaId: media.id },
    });

    return { ok: true as const, data: await getEnterpriseProfile(userId) };
  } catch (e: unknown) {
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? String((e as { code?: unknown }).code)
        : "";
    if (code === "INVALID_IMAGE_PAYLOAD") {
      return {
        ok: false as const,
        status: 400,
        message: "Selected image could not be processed. Please try another image.",
        code: "INVALID_IMAGE_PAYLOAD",
      };
    }
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.error("uploadProfilePhoto failed", e);
    }
    return {
      ok: false as const,
      status: 500,
      message: "Could not upload your profile photo. Please try again.",
      code: "FILE_UPLOAD_FAILED",
    };
  }
}

export async function removeProfilePhoto(req: Request, userId: number) {
  const gate = await assertCanMutate(userId);
  if (gate) return { ok: false as const, status: gate.status, message: gate.message };

  const before = await prisma.userProfile.findUnique({
    where: { userId },
    select: { avatarMediaId: true },
  });

  await prisma.user.update({
    where: { id: userId },
    data: {
      profile: {
        update: {
          avatarMedia: { disconnect: true },
        },
      },
    },
  });

  if (before?.avatarMediaId != null) {
    try {
      const mediaService = require("../media/media.service");
      await mediaService.deleteMyMedia({ ownerUserId: userId, mediaId: before.avatarMediaId });
    } catch {
      // Non-fatal cleanup
    }
  }

  await writeAudit({
    prisma,
    req,
    action: "PROFILE_PHOTO_REMOVED",
    entityType: AuditEntityType.USER,
    entityId: String(userId),
    before: before ?? null,
    after: { avatarMediaId: null },
  });

  return { ok: true as const, data: await getEnterpriseProfile(userId) };
}

export async function getSelfAudit(userId: number, limit: number) {
  const rows = await prisma.auditLog.findMany({
    where: {
      actorId: String(userId),
      entityType: AuditEntityType.USER,
      entityId: String(userId),
      action: {
        in: [
          "PROFILE_UPDATED",
          "PROFILE_PHOTO_UPDATED",
          "PROFILE_PHOTO_REMOVED",
          "PROFILE_BOOTSTRAPPED_FROM_PROVIDER",
          "PROVIDER_PROFILE_SYNCED",
          "USER_PREFERENCES_UPDATED",
          "USER_NOTIFICATION_PREFS_UPDATED",
          "ACTIVE_BRANCH_CHANGED",
          "PASSWORD_CHANGED",
        ],
      },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true,
      action: true,
      before: true,
      after: true,
      createdAt: true,
      ip: true,
    },
  });
  return rows;
}

export { getUserId };
