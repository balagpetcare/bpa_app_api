const prisma = require("../../../../infrastructure/db/prismaClient");
const { writeAudit } = require("../../../../middlewares/auditWriter");

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

exports.list = async (req, res) => {
  try {
    const countryId = toInt(req.params?.countryId);
    if (!countryId) return res.status(400).json({ success: false, message: "Invalid countryId" });

    const rows = await prisma.userCountryRole.findMany({
      where: { countryId },
      include: {
        user: { select: { id: true, status: true, profile: { select: { displayName: true, username: true } } } },
        role: { select: { id: true, key: true, label: true, scope: true } },
      },
      orderBy: [{ createdAt: "desc" }],
    });

    const data = rows.map((r) => ({
      userId: r.userId,
      countryId: r.countryId,
      roleId: r.roleId,
      role: r.role,
      user: r.user,
      createdAt: r.createdAt,
    }));

    return res.json({ success: true, data });
  } catch (e) {
    console.error("admin_country_users.list error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.assign = async (req, res) => {
  try {
    const countryId = toInt(req.params?.countryId);
    const userId = toInt(req.body?.userId);
    const roleId = toInt(req.body?.roleId);
    const roleKey = req.body?.roleKey ? String(req.body.roleKey).trim() : "";

    if (!countryId) return res.status(400).json({ success: false, message: "Invalid countryId" });
    if (!userId) return res.status(400).json({ success: false, message: "userId required" });

    let role = null;
    if (roleId) {
      role = await prisma.role.findUnique({ where: { id: roleId } });
    } else if (roleKey) {
      role = await prisma.role.findUnique({ where: { key: roleKey } });
    }

    if (!role || role.scope !== "COUNTRY") {
      return res.status(400).json({ success: false, message: "Valid COUNTRY role required" });
    }

    const row = await prisma.userCountryRole.upsert({
      where: { userId_countryId_roleId: { userId, countryId, roleId: role.id } },
      update: {},
      create: { userId, countryId, roleId: role.id },
    });

    await writeAudit({
      prisma: req.prisma,
      req,
      action: "COUNTRY_ROLE_ASSIGN",
      entityType: "USER_COUNTRY_ROLE",
      entityId: `${userId}:${countryId}:${role.id}`,
      before: null,
      after: row,
    });

    return res.status(201).json({ success: true, data: row });
  } catch (e) {
    console.error("admin_country_users.assign error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.remove = async (req, res) => {
  try {
    const countryId = toInt(req.params?.countryId);
    const userId = toInt(req.params?.userId);
    const roleId = toInt(req.params?.roleId);
    if (!countryId || !userId || !roleId) {
      return res.status(400).json({ success: false, message: "Invalid ids" });
    }

    await prisma.userCountryRole.delete({
      where: { userId_countryId_roleId: { userId, countryId, roleId } },
    });
    await writeAudit({
      prisma: req.prisma,
      req,
      action: "COUNTRY_ROLE_REMOVE",
      entityType: "USER_COUNTRY_ROLE",
      entityId: `${userId}:${countryId}:${roleId}`,
      before: null,
      after: { removed: true },
    });
    return res.json({ success: true });
  } catch (e) {
    console.error("admin_country_users.remove error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export {};

