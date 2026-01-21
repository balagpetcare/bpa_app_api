const prisma = require("../../../../infrastructure/db/prismaClient");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const appConfig = require("../../../../config/appConfig");

function normalizePhoneDigits(v) {
  return String(v || "").replace(/\D/g, "");
}

async function isAdminAllowed(userId) {
  // ✅ BPA Standard: DB whitelist is the source of truth
  const auth = await prisma.userAuth.findUnique({
    where: { userId: Number(userId) },
    select: { phone: true, email: true },
  });

  const phoneDigits = normalizePhoneDigits(auth?.phone);
  const phoneLast11 = phoneDigits.length > 11 ? phoneDigits.slice(-11) : phoneDigits;
  const emailNorm = String(auth?.email || "").trim().toLowerCase();

  const hit = await prisma.superAdminWhitelist.findFirst({
    where: {
      isActive: true,
      OR: [
        emailNorm ? { email: { equals: emailNorm, mode: "insensitive" } } : undefined,
        phoneDigits ? { phone: phoneDigits } : undefined,
        phoneLast11 ? { phone: phoneLast11 } : undefined,
      ].filter(Boolean),
    },
    select: { id: true },
  });

  if (hit) return true;

  // 🚑 Emergency fallback: old env allowlists (dev/ops rescue only)
  const allowIds = String(process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map((x) => Number(String(x).trim()))
    .filter(Boolean);
  if (allowIds.includes(Number(userId))) return true;

  const allowPhones = String(process.env.ADMIN_PHONES || "")
    .split(",")
    .map((x) => normalizePhoneDigits(x))
    .filter(Boolean);
  const allowEmails = String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((x) => String(x || "").trim().toLowerCase())
    .filter(Boolean);

  if (allowPhones.length && phoneDigits && allowPhones.includes(phoneDigits)) return true;
  if (allowPhones.length && phoneLast11 && allowPhones.includes(phoneLast11)) return true;
  if (allowEmails.length && emailNorm && allowEmails.includes(emailNorm)) return true;

  return false;
}

/**
 * POST /api/v1/admin/auth/login
 * Body: { email? or phone?, password }
 * - does NOT change public /auth/login behavior (Flutter safe)
 * - rejects users who are not in admin allowlists
 */
exports.login = async (req, res) => {
  try {
    const { email, phone, password } = req.body;

    const emailNorm = (email || "").trim().toLowerCase();
    const phoneNormRaw = (phone || "").trim();
    const phoneNorm = phoneNormRaw ? phoneNormRaw.replace(/\D/g, "") : "";

    if (!emailNorm && !phoneNorm) {
      return res.status(400).json({ success: false, message: "email or phone is required" });
    }
    if (!password) {
      return res.status(400).json({ success: false, message: "password is required" });
    }

    const authRow = await prisma.userAuth.findFirst({
      where: {
        OR: [
          emailNorm ? { email: { equals: emailNorm, mode: "insensitive" } } : undefined,
          phoneNorm ? { phone: phoneNorm } : undefined,
        ].filter(Boolean),
      },
      include: {
        user: { include: { profile: true } },
      },
    });

    if (!authRow || !authRow.user) {
      return res.status(400).json({ success: false, message: "User not found" });
    }

    const storedHash = authRow.passwordHash || authRow.password;
    if (!storedHash) {
      return res.status(500).json({ success: false, message: "Password not set for this user" });
    }

    const isMatch = await bcrypt.compare(password, storedHash);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Invalid credentials" });
    }

    // Admin gate BEFORE issuing a long-lived cookie
    const ok = await isAdminAllowed(authRow.user.id);
    if (!ok) {
      // Clear any existing cookie to avoid chrome stale-cookie loops
      const isProd = String(process.env.NODE_ENV || "development") === "production";
      res.clearCookie("access_token", {
        httpOnly: true,
        sameSite: "lax",
        secure: isProd,
        path: "/",
      });
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const token = jwt.sign({ id: authRow.user.id }, appConfig.jwt.secret, { expiresIn: "7d" });

    // Same cookie as /auth/login (Admin web depends on this)
    res.cookie("access_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: String(process.env.NODE_ENV || "development") === "production",
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: authRow.user.id,
        email: authRow.email || null,
        phone: authRow.phone || null,
        displayName: authRow.user.profile?.displayName || null,
        username: authRow.user.profile?.username || null,
      },
    });
  } catch (e) {
    console.error("Admin login error:", e);
    return res.status(500).json({ success: false, message: "Login failed" });
  }
};

/**
 * GET /api/v1/admin/auth/me
 * Uses the SAME payload as public /auth/me but always admin
 */
exports.me = async (req, res) => {
  // Since we already enforce requireAdmin middleware, we can reuse the public auth controller behavior
  // without modifying it: just return the same structure for UI.
  try {
    const userId = req.user?.id;
    const user = await prisma.user.findUnique({
      where: { id: Number(userId) },
      include: { auth: true, profile: true, wallet: true },
    });

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    return res.status(200).json({
      success: true,
      data: user,
      role: "ADMIN",
      permissions: [
        "dashboard.read",
        "branch.read",
        "branch.write",
        "staff.read",
        "staff.write",
        "wallet.read",
        "wallet.withdraw_request.read",
        "wallet.withdraw.approve",
        "fundraising.read",
        "fundraising.verify",
        "users.read",
        "settings.write",
      ],
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

/**
 * POST /api/v1/admin/auth/logout
 */
exports.logout = async (req, res) => {
  try {
    const isProd = String(process.env.NODE_ENV || "development") === "production";
    res.clearCookie("access_token", {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      path: "/",
    });
    return res.status(200).json({ success: true, message: "Logged out" });
  } catch {
    return res.status(500).json({ success: false, message: "Logout failed" });
  }
};

export {};
