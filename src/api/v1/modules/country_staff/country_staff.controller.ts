const prisma = require("../../../../infrastructure/db/prismaClient");

function toInt(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

exports.listRoles = async (req, res) => {
  try {
    const roles = await prisma.role.findMany({
      where: { scope: "COUNTRY" },
      select: { id: true, key: true, label: true, scope: true },
      orderBy: { id: "asc" },
    });
    return res.json({ success: true, data: roles });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.list = async (req, res) => {
  try {
    const countryId = req.countryContext?.countryId;
    if (!countryId) {
      return res.status(400).json({ success: false, message: "Country context required" });
    }

    const rows = await prisma.userCountryRole.findMany({
      where: { countryId: Number(countryId) },
      include: {
        user: { include: { auth: true, profile: true } },
        role: { select: { id: true, key: true, label: true, scope: true } },
        country: { select: { id: true, code: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const grouped = new Map();
    for (const row of rows) {
      const uid = row.userId;
      if (!grouped.has(uid)) {
        grouped.set(uid, {
          userId: uid,
          user: {
            id: row.user?.id,
            displayName: row.user?.profile?.displayName || null,
            email: row.user?.auth?.email || null,
            phone: row.user?.auth?.phone || null,
          },
          country: row.country || null,
          roles: [],
          assignedAt: row.createdAt,
        });
      }
      grouped.get(uid).roles.push(row.role);
    }

    return res.json({ success: true, data: Array.from(grouped.values()) });
  } catch (e) {
    console.error("country_staff.list error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.assignRole = async (req, res) => {
  try {
    const countryId = req.countryContext?.countryId;
    if (!countryId) {
      return res.status(400).json({ success: false, message: "Country context required" });
    }

    const userId = toInt(req.params.userId);
    const roleId = toInt(req.body?.roleId);
    if (!userId || !roleId) {
      return res.status(400).json({ success: false, message: "userId and roleId are required" });
    }

    const role = await prisma.role.findUnique({
      where: { id: roleId },
      select: { id: true, key: true, label: true, scope: true },
    });
    if (!role || role.scope !== "COUNTRY") {
      return res.status(400).json({ success: false, message: "Invalid country role" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const row = await prisma.userCountryRole.upsert({
      where: {
        userId_countryId_roleId: {
          userId,
          countryId: Number(countryId),
          roleId,
        },
      },
      update: {},
      create: {
        userId,
        countryId: Number(countryId),
        roleId,
      },
    });

    return res.json({ success: true, data: row });
  } catch (e) {
    console.error("country_staff.assignRole error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.removeRole = async (req, res) => {
  try {
    const countryId = req.countryContext?.countryId;
    if (!countryId) {
      return res.status(400).json({ success: false, message: "Country context required" });
    }

    const userId = toInt(req.params.userId);
    const roleId = toInt(req.params.roleId);
    if (!userId || !roleId) {
      return res.status(400).json({ success: false, message: "userId and roleId are required" });
    }

    await prisma.userCountryRole.delete({
      where: {
        userId_countryId_roleId: {
          userId,
          countryId: Number(countryId),
          roleId,
        },
      },
    });

    return res.json({ success: true });
  } catch (e) {
    console.error("country_staff.removeRole error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export {};
