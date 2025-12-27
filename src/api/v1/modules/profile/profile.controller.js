const prisma = require("../../../../infrastructure/db/prismaClient");

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

    
    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (e) {
    console.error("getMyProfile error:", e);
    return res.status(500).json({ success: false, message: "Failed to load profile" });
  }
};
