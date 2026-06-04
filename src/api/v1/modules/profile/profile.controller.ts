
import { prisma } from "../../../../lib/prisma";
import { Prisma, ProfileVisibility, AuditEntityType } from "@prisma/client";

const { writeAudit } = require("../../../../middlewares/auditWriter");
const { resolveUserProfileLocationUpdate } = require("../me/meProfile.service");

/* ---------------- helpers ---------------- */

function toNullableString(v: any): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function toNullableBool(v: any): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (v === true || v === "true" || v === 1 || v === "1") return true;
  if (v === false || v === "false" || v === 0 || v === "0") return false;
  return undefined;
}

function toNullableInt(v: any): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function handleUnique(res: any, e: any) {
  if (e && e.code === "P2002") {
    const targets = e.meta?.target || [];
    const arr = Array.isArray(targets) ? targets : [targets];
    if (arr.includes("username")) {
      return res.status(409).json({
        success: false,
        message: "Username already taken",
        field: "username",
      });
    }
  }
  return null;
}

/* ---------------- GET /api/v1/user/me ---------------- */

exports.getMyProfile = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        auth: true,
        profile: {
          include: {
            avatarMedia: true,
            coverMedia: true,
          },
        },
        wallet: true,
        pets: {
          where: { deleted: false },
          include: {
            animalType: true,
            breed: true,
            profilePic: true,
          },
          orderBy: { createdAt: "desc" },
        },
        galleryItems: {
          where: { deleted: false },
          include: { media: true },
          orderBy: { createdAt: "desc" },
          take: 60,
        },
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const [followersCount, followingCount, followerPreview] = await Promise.all([
      prisma.userFollow.count({ where: { followingId: userId } }),
      prisma.userFollow.count({ where: { followerId: userId } }),
      prisma.userFollow.findMany({
        where: { followingId: userId },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          follower: {
            include: {
              profile: { include: { avatarMedia: true } },
            },
          },
        },
      }),
    ]);

    const followerPreviewUrls = (followerPreview || [])
      .map((r) => r?.follower?.profile?.avatarMedia?.url)
      .filter(Boolean);

    return res.status(200).json({
      success: true,
      data: {
        ...user,
        followersCount,
        followingCount,
        followerPreviewUrls,
      },
    });
  } catch (e) {
    console.error("getMyProfile error:", e);
    return res.status(500).json({ success: false, message: "Failed to load profile" });
  }
};

/* ---------------- PATCH /api/v1/user/me ---------------- */

exports.updateMyProfile = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

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
      address,
    } = req.body || {};

    const locationResolved = await resolveUserProfileLocationUpdate(req.body || {});
    if (locationResolved.ok === false) {
      return res.status(400).json({ success: false, message: locationResolved.message });
    }

    const beforeSnap = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        profile: {
          select: {
            displayName: true,
            avatarMediaId: true,
          },
        },
      },
    });

    const profileData: Prisma.UserProfileUpdateInput = {};
const authData: Prisma.UserAuthUpdateInput = {};

// strings
if (displayName !== undefined) profileData.displayName = toNullableString(displayName);
if (username !== undefined) profileData.username = toNullableString(username);
if (bio !== undefined) profileData.bio = toNullableString(bio);

// visibility (enum)
if (visibility !== undefined) {
  const v = String(visibility || "").trim().toUpperCase();
  if (v && !Object.values(ProfileVisibility).includes(v as ProfileVisibility)) {
    return res.status(400).json({ success: false, message: "Invalid visibility" });
  }
  if (v) profileData.visibility = v as ProfileVisibility;
}

// booleans
const se = toNullableBool(showEmail);
const sp = toNullableBool(showPhone);
if (se !== undefined) profileData.showEmail = se;
if (sp !== undefined) profileData.showPhone = sp;

// avatar/cover relation connect/disconnect
const aIdRaw = req.body?.avatarMediaId;
const cIdRaw = req.body?.coverMediaId;

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

// auth
if (email !== undefined) authData.email = toNullableString(email);
if (phone !== undefined) authData.phone = toNullableString(phone);

if (locationResolved.ok && locationResolved.data && !("skip" in locationResolved)) {
  profileData.divisionId = locationResolved.data.divisionId;
  profileData.districtId = locationResolved.data.districtId;
  profileData.upazilaId = locationResolved.data.upazilaId;
  profileData.unionId = locationResolved.data.unionId;
  profileData.areaId = locationResolved.data.areaId;
}

    // nothing to update
    if (
      Object.keys(profileData).length === 0 &&
      Object.keys(authData).length === 0
    ) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          auth: true,
          profile: { include: { avatarMedia: true, coverMedia: true } },
          wallet: true,
        },
      });
      return res.status(200).json({ success: true, data: user });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(Object.keys(profileData).length
          ? { profile: { update: profileData } }
          : {}),
        ...(Object.keys(authData).length
          ? { auth: { update: authData } }
          : {}),
      },
      include: {
        auth: true,
        profile: { include: { avatarMedia: true, coverMedia: true } },
        wallet: true,
        pets: {
          where: { deleted: false },
          include: { animalType: true, breed: true, subBreed: true, color: true, size: true, profilePic: true },
          orderBy: { createdAt: "desc" },
        },
        galleryItems: {
          where: { deleted: false },
          include: { media: true },
          orderBy: { createdAt: "desc" },
          take: 60,
        },
      },
    });

    const photoChanged =
      aId !== undefined &&
      Number(beforeSnap?.profile?.avatarMediaId || 0) !== Number(updated?.profile?.avatarMediaId || 0);

    await writeAudit({
      prisma,
      req,
      action: photoChanged ? "PROFILE_PHOTO_UPDATED" : "PROFILE_UPDATED",
      entityType: AuditEntityType.USER,
      entityId: String(userId),
      before: beforeSnap ?? null,
      after: { profile: profileData, auth: authData },
    });

    return res.status(200).json({ success: true, data: updated });
  } catch (e: any) {
    const handled = handleUnique(res, e);
    if (handled) return handled;
    console.error("updateMyProfile error:", e);
    return res.status(500).json({
      success: false,
      message: e?.message || "Failed to update profile",
    });
  }
};

/* ---------------- GET /api/v1/user/:id ---------------- */

exports.getUserById = async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        profile: { include: { avatarMedia: true, coverMedia: true } },
        wallet: true,
        pets: {
          where: { deleted: false },
          include: { animalType: true, breed: true, subBreed: true, color: true, size: true, profilePic: true },
          orderBy: { createdAt: "desc" },
        },
        galleryItems: {
          where: { deleted: false },
          include: { media: true },
          orderBy: { createdAt: "desc" },
          take: 60,
        },
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const [followersCount, followingCount, followerPreview] = await Promise.all([
      prisma.userFollow.count({ where: { followingId: id } }),
      prisma.userFollow.count({ where: { followerId: id } }),
      prisma.userFollow.findMany({
        where: { followingId: id },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          follower: {
            include: {
              profile: { include: { avatarMedia: true } },
            },
          },
        },
      }),
    ]);

    const followerPreviewUrls = (followerPreview || [])
      .map((r) => r?.follower?.profile?.avatarMedia?.url)
      .filter(Boolean);

    return res.status(200).json({
      success: true,
      data: {
        ...user,
        followersCount,
        followingCount,
        followerPreviewUrls,
      },
    });
  } catch (e) {
    console.error("getUserById error:", e);
    return res.status(500).json({ success: false, message: "Failed to load user profile" });
  }
};
