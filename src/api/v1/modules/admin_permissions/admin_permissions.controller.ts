const prisma = require("../../../../infrastructure/db/prismaClient");

exports.list = async (req, res) => {
  try {
    const rows = await prisma.permission.findMany({
      orderBy: { key: "asc" },
    });
    return res.json({ success: true, data: rows });
  } catch (e) {
    console.error("admin_permissions.list error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

export {};
