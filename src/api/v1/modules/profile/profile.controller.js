const prisma = require("../../../../infrastructure/db/prismaClient");

function toNullableString(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function toNullableBool(v) {
  if (v === undefined || v === null) return undefined;
  if (v === true || v === "true" || v === 1 || v === "1") return true;
  if (v === false || v === "false" || v === 0 || v === "0") return false;
  return undefined;
}

function toNullableInt(v) {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function handleUnique(res, e) {
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

// GET /api/v1/user/me
exports.getMyProfile = async (req, res) => {
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
            avatarMedia: true, // avatar url
            coverMedia: true,  // cover url
          },
        },
        wallet: true,

        // ✅ pets => profilePic.url নিশ্চিত
        pets: {
          where: { deleted: false },
          include: {
            animalType: true,
            breed: true,
            profilePic: true, // ✅ { url }
          },
          orderBy: { createdAt: "desc" },
        },

        // ✅ Profile Gallery (Facebook-style) এর জন্য
        galleryItems: {
          where: { deleted: false },
          include: { media: true }, // ✅ { url }
          orderBy: { createdAt: "desc" },
          take: 60,
        },
      },
    });


    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

      // ✅ debug output
    if (req.query.debug === "1") {
      return res.json({
        success: true,
        debug: {
          avatarUrl: user?.profile?.avatarMedia?.url ?? null,
          coverUrl: user?.profile?.coverMedia?.url ?? null,
          petPhotoUrls: (user.pets ?? []).map(p => ({
            id: p.id,
            name: p.name,
            profilePicUrl: p?.profilePic?.url ?? null,
          })),
        },
        data: user,
      });
    }

    
    // ✅ Followers / Following counts + small preview avatars (4-5)
    const [followersCount, followingCount, followerPreview] = await Promise.all([
      prisma.userFollow.count({ where: { followingId: userId } }),
      prisma.userFollow.count({ where: { followerId: userId } }),
      prisma.userFollow.findMany({
        where: { followingId: userId },
        orderBy: { createdAt: 'desc' },
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

// PATCH/PUT /api/v1/user/me
// Updates profile fields + avatar/cover media ids + auth email/phone (optional)
exports.updateMyProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

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

    const profileData = {};

    if (displayName !== undefined) profileData.displayName = toNullableString(displayName);
    if (username !== undefined) profileData.username = toNullableString(username);
    if (bio !== undefined) profileData.bio = toNullableString(bio);
    if (visibility !== undefined) profileData.visibility = toNullableString(visibility);

    const se = toNullableBool(showEmail);
    const sp = toNullableBool(showPhone);
    if (se !== undefined) profileData.showEmail = se;
    if (sp !== undefined) profileData.showPhone = sp;

    const aId = toNullableInt(avatarMediaId);
    const cId = toNullableInt(coverMediaId);
    if (aId !== undefined) profileData.avatarMediaId = aId;
    if (cId !== undefined) profileData.coverMediaId = cId;
    if (address !== undefined) profileData.address = toNullableString(address);

    const authData = {};
    if (email !== undefined) authData.email = toNullableString(email);
    if (phone !== undefined) authData.phone = toNullableString(phone);

    // If nothing to update, return current profile
    if (Object.keys(profileData).length === 0 && Object.keys(authData).length === 0) {
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
        ...(Object.keys(authData).length ? { auth: { update: authData } } : {}),
      },
      include: {
        auth: true,
        profile: { include: { avatarMedia: true, coverMedia: true } },
        wallet: true,
        pets: {
          where: { deleted: false },
          include: { animalType: true, breed: true, profilePic: true },
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

    return res.status(200).json({ success: true, data: updated });
  } catch (e) {
    const handled = handleUnique(res, e);
    if (handled) return handled;
    console.error("updateMyProfile error:", e);
    return res.status(500).json({ success: false, message: e.message || "Failed to update profile" });
  }
};

// GET /api/v1/user/:id
exports.getUserById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid user id" });

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        profile: { include: { avatarMedia: true, coverMedia: true } },
        wallet: true,
        pets: {
          where: { deleted: false },
          include: { animalType: true, breed: true, profilePic: true },
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

    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    const [followersCount, followingCount, followerPreview] = await Promise.all([
      prisma.userFollow.count({ where: { followingId: id } }),
      prisma.userFollow.count({ where: { followerId: id } }),
      prisma.userFollow.findMany({
        where: { followingId: id },
        orderBy: { createdAt: 'desc' },
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
