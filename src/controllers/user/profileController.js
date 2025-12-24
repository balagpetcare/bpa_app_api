const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// GET /api/v1/profile/me
exports.getMyProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,     // আপনার user table field অনুযায়ী adjust
        email: true,
        phone: true,
        avatarUrl: true,    // আপনার field অনুযায়ী adjust
        createdAt: true,
        pets: {
          orderBy: { id: "desc" },
          select: {
            id: true,
            name: true,
            sex: true,
            profilePicUrl: true, // pet image field
            animalType: { select: { id: true, name: true } },
            breed: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({
      success: true,
      data: { user },
    });
  } catch (e) {
    console.error("getMyProfile error:", e);
    return res.status(500).json({ success: false, message: "Failed to load profile" });
  }
};
