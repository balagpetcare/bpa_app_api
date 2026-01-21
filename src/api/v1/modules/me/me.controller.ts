const prisma = require("../../../../infrastructure/db/prismaClient");

/**
 * GET /api/v1/me
 * Returns logged-in user + org/branch memberships (ACTIVE only)
 */
exports.getMe = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        status: true,
        auth: { select: { phone: true, email: true } },
        profile: { select: { displayName: true, avatarUrl: true } },
      },
    });

    const orgMembers = await prisma.orgMember.findMany({
      where: { userId, status: "ACTIVE" },
      select: {
        id: true,
        orgId: true,
        role: true,
        status: true,
        org: { select: { id: true, name: true, verificationStatus: true } },
      },
      orderBy: { id: "desc" },
    });

    const branchMemberships = await prisma.branchMember.findMany({
      where: { userId, status: "ACTIVE" },
      select: {
        id: true,
        orgId: true,
        branchId: true,
        role: true,
        status: true,
        branch: {
          select: {
            id: true,
            name: true,
            status: true,
            verificationStatus: true,
            // include branch types (delivery hub detection)
            types: { select: { type: { select: { code: true, nameEn: true } } } },
          },
        },
      },
      orderBy: { id: "desc" },
    });

    return res.json({
      success: true,
      data: {
        user,
        orgMembers,
        branchMemberships,
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export {};
