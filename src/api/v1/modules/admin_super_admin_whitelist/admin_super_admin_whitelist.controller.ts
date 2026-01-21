const prisma = require("../../../../infrastructure/db/prismaClient");

function normalizeEmail(v) {
  const s = String(v || "").trim().toLowerCase();
  return s || null;
}

function normalizePhone(v) {
  const digits = String(v || "").replace(/\D/g, "");
  if (!digits) return null;
  // For BD numbers we keep last 11 digits when prefixed with country code
  return digits.length > 11 ? digits.slice(-11) : digits;
}

function pickSearchWhere(q) {
  const query = String(q || "").trim();
  if (!query) return undefined;

  const email = normalizeEmail(query);
  const phone = normalizePhone(query);

  // If looks like email, use email search; else allow phone or note partial
  const ors = [];
  if (email && email.includes("@")) {
    ors.push({ email: { contains: email, mode: "insensitive" } });
  }
  if (phone) {
    ors.push({ phone: { contains: phone } });
  }
  ors.push({ note: { contains: query, mode: "insensitive" } });

  return { OR: ors };
}

// GET /api/v1/admin/super-admin-whitelist
exports.list = async (req, res) => {
  try {
    const q = req.query?.q;
    const where = pickSearchWhere(q);
    const rows = await prisma.superAdminWhitelist.findMany({
      where,
      orderBy: [{ isActive: "desc" }, { id: "asc" }],
    });
    return res.json({ success: true, data: rows });
  } catch (e) {
    console.error("admin_super_admin_whitelist.list error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// POST /api/v1/admin/super-admin-whitelist
exports.create = async (req, res) => {
  try {
    const email = req.body?.email !== undefined ? normalizeEmail(req.body.email) : null;
    const phone = req.body?.phone !== undefined ? normalizePhone(req.body.phone) : null;
    const note = req.body?.note ? String(req.body.note).trim() : null;
    const isActive = req.body?.isActive === undefined ? true : Boolean(req.body.isActive);

    if (!email && !phone) {
      return res.status(400).json({ success: false, message: "email or phone is required" });
    }
    if (email && !email.includes("@")) {
      return res.status(400).json({ success: false, message: "Invalid email" });
    }
    if (phone && phone.length < 10) {
      return res.status(400).json({ success: false, message: "Invalid phone" });
    }

    const row = await prisma.superAdminWhitelist.create({
      data: { email, phone, note, isActive },
    });

    return res.status(201).json({ success: true, data: row });
  } catch (e) {
    // Prisma unique constraint
    if (e?.code === "P2002") {
      return res.status(409).json({ success: false, message: "Already whitelisted" });
    }
    console.error("admin_super_admin_whitelist.create error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// PATCH /api/v1/admin/super-admin-whitelist/:id
exports.updateById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    // Keep this as `any` to avoid TS2339 (`Property 'email' does not exist on type '{}'`)
    // when this file is consumed in mixed CJS/TS builds.
    const data: any = {};
    if (req.body?.email !== undefined) data.email = normalizeEmail(req.body.email);
    if (req.body?.phone !== undefined) data.phone = normalizePhone(req.body.phone);
    if (req.body?.note !== undefined) data.note = req.body.note ? String(req.body.note).trim() : null;
    if (req.body?.isActive !== undefined) data.isActive = Boolean(req.body.isActive);

    if (data.email && !String(data.email).includes("@")) {
      return res.status(400).json({ success: false, message: "Invalid email" });
    }
    if (data.phone && String(data.phone).length < 10) {
      return res.status(400).json({ success: false, message: "Invalid phone" });
    }

    // Prevent accidental lockout: if caller tries to deactivate their own current identity, block.
    // (Best-effort; relies on userAuth email/phone)
    if (data.isActive === false) {
      const auth = await prisma.userAuth.findUnique({
        where: { userId: Number(req.user?.id) },
        select: { email: true, phone: true },
      });
      const meEmail = normalizeEmail(auth?.email);
      const mePhone = normalizePhone(auth?.phone);

      const target = await prisma.superAdminWhitelist.findUnique({ where: { id } });
      const targetEmail = normalizeEmail(target?.email);
      const targetPhone = normalizePhone(target?.phone);

      const matchesMe = (meEmail && targetEmail && meEmail === targetEmail) || (mePhone && targetPhone && mePhone === targetPhone);
      if (matchesMe) {
        return res.status(400).json({ success: false, message: "You cannot deactivate your own access" });
      }
    }

    const row = await prisma.superAdminWhitelist.update({ where: { id }, data });

    return res.json({ success: true, data: row });
  } catch (e) {
    if (e?.code === "P2002") {
      return res.status(409).json({ success: false, message: "Already whitelisted" });
    }
    console.error("admin_super_admin_whitelist.updateById error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// DELETE /api/v1/admin/super-admin-whitelist/:id
exports.removeById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    // Prevent self-delete lockout (best-effort)
    const auth = await prisma.userAuth.findUnique({
      where: { userId: Number(req.user?.id) },
      select: { email: true, phone: true },
    });
    const meEmail = normalizeEmail(auth?.email);
    const mePhone = normalizePhone(auth?.phone);

    const target = await prisma.superAdminWhitelist.findUnique({ where: { id } });
    if (!target) return res.status(404).json({ success: false, message: "Not found" });
    const targetEmail = normalizeEmail(target?.email);
    const targetPhone = normalizePhone(target?.phone);

    const matchesMe = (meEmail && targetEmail && meEmail === targetEmail) || (mePhone && targetPhone && mePhone === targetPhone);
    if (matchesMe) {
      return res.status(400).json({ success: false, message: "You cannot remove your own access" });
    }

    await prisma.superAdminWhitelist.delete({ where: { id } });
    return res.json({ success: true });
  } catch (e) {
    console.error("admin_super_admin_whitelist.removeById error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

export {};