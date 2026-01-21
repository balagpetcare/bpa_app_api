const prisma = require("../../../../infrastructure/db/prismaClient");
const bcrypt = require("bcrypt");

function normalizeEmail(v) {
  const s = String(v || "").trim().toLowerCase();
  return s || null;
}

function normalizePhone(v) {
  const digits = String(v || "").replace(/\D/g, "");
  if (!digits) return null;
  // For BD numbers keep last 11 digits (supports +880...)
  return digits.length > 11 ? digits.slice(-11) : digits;
}

async function generateUniqueUsername({ emailNorm, phoneNorm, displayName }) {
  let base =
    (emailNorm ? emailNorm.split("@")[0] : "") ||
    (phoneNorm ? `user${phoneNorm.replace(/\D/g, "")}` : "") ||
    (displayName ? displayName.toLowerCase().replace(/\s+/g, "") : "user");

  base = base
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);

  if (!base) base = "user";

  let username = base;
  for (let i = 0; i < 10; i++) {
    const exists = await prisma.userProfile.findFirst({
      where: { username },
      select: { id: true },
    });
    if (!exists) return username;
    const suffix = Math.floor(1000 + Math.random() * 9000);
    username = `${base}_${suffix}`.slice(0, 30);
  }
  return `user_${Date.now()}`;
}

function pickSearchWhere(q) {
  const query = String(q || "").trim();
  if (!query) return undefined;

  const maybeId = Number(query);
  const email = normalizeEmail(query);
  const phone = normalizePhone(query);

  const ors = [];
  if (Number.isFinite(maybeId) && maybeId > 0) {
    ors.push({ id: maybeId });
  }
  if (email && email.includes("@")) {
    ors.push({ auth: { is: { email: { contains: email, mode: "insensitive" } } } });
  }
  if (phone) {
    ors.push({ auth: { is: { phone: { contains: phone } } } });
  }
  ors.push({ profile: { is: { username: { contains: query, mode: "insensitive" } } } });
  ors.push({ profile: { is: { displayName: { contains: query, mode: "insensitive" } } } });

  return { OR: ors };
}

// GET /api/v1/admin/users
exports.list = async (req, res) => {
  try {
    const q = req.query?.q;
    const where = pickSearchWhere(q);

    const rows = await prisma.user.findMany({
      where,
      include: {
        auth: { select: { email: true, phone: true, provider: true, createdAt: true } },
        profile: { select: { displayName: true, username: true } },
      },
      orderBy: { id: "desc" },
      take: 200,
    });

    const data = rows.map((u) => ({
      id: u.id,
      status: u.status,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      email: u.auth?.email || null,
      phone: u.auth?.phone || null,
      provider: u.auth?.provider || null,
      displayName: u.profile?.displayName || null,
      username: u.profile?.username || null,
    }));

    return res.json({ success: true, data });
  } catch (e) {
    console.error("admin_users.list error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// POST /api/v1/admin/users
exports.create = async (req, res) => {
  try {
    const displayName = String(req.body?.displayName || "").trim() || "New User";
    const email = req.body?.email !== undefined ? normalizeEmail(req.body.email) : null;
    const phone = req.body?.phone !== undefined ? normalizePhone(req.body.phone) : null;
    const password = String(req.body?.password || "");

    if (!email && !phone) {
      return res.status(400).json({ success: false, message: "email or phone is required" });
    }
    if (email && !email.includes("@")) {
      return res.status(400).json({ success: false, message: "Invalid email" });
    }
    if (phone && phone.length < 10) {
      return res.status(400).json({ success: false, message: "Invalid phone" });
    }
    if (!password || password.length < 4) {
      return res.status(400).json({ success: false, message: "password is required (min 4 chars)" });
    }

    // prevent duplicates
    const existingAuth = await prisma.userAuth.findFirst({
      where: {
        OR: [
          email ? { email: { equals: email, mode: "insensitive" } } : undefined,
          phone ? { phone } : undefined,
        ].filter(Boolean),
      },
      select: { id: true },
    });

    if (existingAuth) {
      return res.status(409).json({ success: false, message: "User already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const username = await generateUniqueUsername({ emailNorm: email, phoneNorm: phone, displayName });

    const user = await prisma.user.create({
      data: {
        status: "ACTIVE",
        auth: {
          create: {
            provider: "LOCAL",
            email,
            phone,
            passwordHash,
          },
        },
        profile: {
          create: {
            displayName,
            username,
          },
        },
        wallet: {
          create: {
            balance: 0.0,
            points: 0,
            tier: "Bronze",
            currency: "BDT",
          },
        },
      },
      include: { auth: true, profile: true },
    });

    return res.status(201).json({
      success: true,
      data: {
        id: user.id,
        status: user.status,
        email: user.auth?.email || null,
        phone: user.auth?.phone || null,
        displayName: user.profile?.displayName || null,
        username: user.profile?.username || null,
      },
    });
  } catch (e) {
    if (e?.code === "P2002") {
      return res.status(409).json({ success: false, message: "Email/Phone already in use" });
    }
    console.error("admin_users.create error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// PATCH /api/v1/admin/users/:id
exports.updateById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const status = req.body?.status !== undefined ? String(req.body.status).toUpperCase() : undefined;
    const displayName = req.body?.displayName !== undefined ? String(req.body.displayName || "").trim() : undefined;
    const email = req.body?.email !== undefined ? normalizeEmail(req.body.email) : undefined;
    const phone = req.body?.phone !== undefined ? normalizePhone(req.body.phone) : undefined;

    if (status && !["ACTIVE", "BLOCKED", "DELETED"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }
    if (email && !String(email).includes("@")) {
      return res.status(400).json({ success: false, message: "Invalid email" });
    }
    if (phone && String(phone).length < 10) {
      return res.status(400).json({ success: false, message: "Invalid phone" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: status ? { status } : {},
      });

      if (displayName !== undefined) {
        await tx.userProfile.upsert({
          where: { userId: id },
          update: { displayName: displayName || "New User" },
          create: { userId: id, displayName: displayName || "New User", username: await generateUniqueUsername({ emailNorm: null, phoneNorm: null, displayName: displayName || "New User" }) },
        });
      }

      if (email !== undefined || phone !== undefined) {
        await tx.userAuth.upsert({
          where: { userId: id },
          update: {
            ...(email !== undefined ? { email } : {}),
            ...(phone !== undefined ? { phone } : {}),
          },
          create: {
            userId: id,
            provider: "LOCAL",
            email: email !== undefined ? email : null,
            phone: phone !== undefined ? phone : null,
            passwordHash: null,
          },
        });
      }

      const full = await tx.user.findUnique({
        where: { id },
        include: { auth: true, profile: true },
      });
      return full;
    });

    return res.json({
      success: true,
      data: {
        id: updated.id,
        status: updated.status,
        email: updated.auth?.email || null,
        phone: updated.auth?.phone || null,
        displayName: updated.profile?.displayName || null,
        username: updated.profile?.username || null,
      },
    });
  } catch (e) {
    if (e?.code === "P2002") {
      return res.status(409).json({ success: false, message: "Email/Phone already in use" });
    }
    console.error("admin_users.updateById error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// PATCH /api/v1/admin/users/:id/password
exports.resetPassword = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const password = String(req.body?.password || "");
    if (!password || password.length < 4) {
      return res.status(400).json({ success: false, message: "password is required (min 4 chars)" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.userAuth.update({
      where: { userId: id },
      data: { passwordHash, passwordUpdatedAt: new Date() },
    });

    return res.json({ success: true });
  } catch (e) {
    console.error("admin_users.resetPassword error", e);
    // userAuth may not exist
    if (String(e?.message || "").includes("Record to update not found")) {
      return res.status(404).json({ success: false, message: "User auth not found" });
    }
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

export {};
