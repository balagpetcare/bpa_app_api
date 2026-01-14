const prisma = require("../../../../infrastructure/db/prismaClient");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const appConfig = require("../../../../config/appConfig");

async function generateUniqueUsername({ emailNorm, phoneNorm, displayName }) {
  // base username
  let base =
    (emailNorm ? emailNorm.split("@")[0] : "") ||
    (phoneNorm ? `user${phoneNorm.replace(/\D/g, "")}` : "") ||
    (displayName ? displayName.toLowerCase().replace(/\s+/g, "") : "user");

  // sanitize
  base = base
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);

  if (!base) base = "user";

  // try base, then base_1234...
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

  // worst case fallback
  return `user_${Date.now()}`;
}

/**
 * REGISTER
 * Body: { name?, email?, phone?, password, address? }
 */
exports.register = async (req, res) => {
  try {
    const { name, email, phone, password, address } = req.body;

    const emailNorm = (email || "").trim().toLowerCase();
    const phoneNormRaw = (phone || "").trim();
    // Normalize phone to digits-only for matching stored values consistently (e.g., "+880 17..." -> "88017...")
    const phoneNorm = phoneNormRaw ? phoneNormRaw.replace(/\D/g, "") : "";

    if (!emailNorm && !phoneNorm) {
      return res.status(400).json({ success: false, message: "email or phone is required" });
    }

    if (!password || password.length < 4) {
      return res.status(400).json({ success: false, message: "password is required (min 4 chars)" });
    }

    // ✅ check existing in UserAuth
    const existingAuth = await prisma.userAuth.findFirst({
      where: {
        OR: [
          emailNorm ? { email: { equals: emailNorm, mode: "insensitive" } } : undefined,
          phoneNorm ? { phone: phoneNorm } : undefined,
        ].filter(Boolean),
      },
      select: { id: true, userId: true },
    });

    if (existingAuth) {
      return res.status(400).json({ success: false, message: "User already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // ✅ required profile fields
    const displayName = (name && name.trim()) ? name.trim() : "New User";
    const username = await generateUniqueUsername({ emailNorm, phoneNorm, displayName });

    // ✅ create user with nested relations only (User has relations: auth/profile/wallet)
    const user = await prisma.user.create({
      data: {
        auth: {
          create: {
            email: emailNorm || null,
            phone: phoneNorm || null,

            // IMPORTANT: if your field is "password" not "passwordHash"
            passwordHash,
          },
        },
        profile: {
          create: {
            displayName, // REQUIRED
            username,    // REQUIRED
            ...(address ? { address } : {}),
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
      include: { auth: true, profile: true, wallet: true },
    });

    const token = jwt.sign({ id: user.id }, appConfig.jwt.secret, { expiresIn: "7d" });

    return res.status(201).json({
      success: true,
      message: "User registered successfully!",
      token,
      user: {
        id: user.id,
        email: user.auth?.email || null,
        phone: user.auth?.phone || null,
        displayName: user.profile?.displayName || null,
        username: user.profile?.username || null,
      },
    });
  } catch (error) {
    console.error("Register Error:", error);
    return res.status(500).json({
      success: false,
      message: "Registration failed",
      error: error.message,
    });
  }
};

/**
 * LOGIN
 * Body: { email? or phone?, password }
 */
exports.login = async (req, res) => {
  try {
    const { email, phone, password } = req.body;

    const emailNorm = (email || "").trim().toLowerCase();
    const phoneNormRaw = (phone || "").trim();
    // Normalize phone to digits-only for matching stored values consistently (e.g., "+880 17..." -> "88017...")
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
        user: { include: { profile: true, wallet: true } },
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

    const token = jwt.sign({ id: authRow.user.id }, appConfig.jwt.secret, { expiresIn: "7d" });

    // ✅ Also set HttpOnly cookie (keeps old Bearer flow intact)
    res.cookie("access_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
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
  } catch (error) {
    console.error("Login Error:", error);
    return res.status(500).json({ success: false, message: "Login failed", error: error.message });
  }
};

/**
 * GET /api/v1/auth/me
 */
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        auth: true,
        profile: true,
        wallet: true,
        pets: true,
      },
    });

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Phase-1 admin access (no schema change):
    // - ADMIN_USER_IDS: comma-separated user IDs
    // - ADMIN_PHONES: comma-separated phones (supports +880 / spaces; compared by digits)
    // - ADMIN_EMAILS: comma-separated emails (lowercased)
    const allowIds = String(process.env.ADMIN_USER_IDS || "")
      .split(",")
      .map((x) => Number(x.trim()))
      .filter(Boolean);

    const allowPhones = String(process.env.ADMIN_PHONES || "")
      .split(",")
      .map((x) => String(x).trim())
      .filter(Boolean)
      .map((x) => x.replace(/\D/g, ""));

    const allowEmails = String(process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((x) => String(x).trim().toLowerCase())
      .filter(Boolean);

    const userPhoneRaw = (
      user?.auth?.phone ||
      user?.auth?.mobile ||
      user?.phone ||
      user?.profile?.phone ||
      ""
    );
    let userPhoneDigits = String(userPhoneRaw).replace(/\D/g, "");
    // BD normalize: if starts with 880, compare also last 11 digits
    const userPhoneLast11 = userPhoneDigits.length > 11 ? userPhoneDigits.slice(-11) : userPhoneDigits;

    const userEmail = String(user?.auth?.email || user?.email || "").toLowerCase();

    const isAdmin =
      allowIds.includes(user.id) ||
      (userPhoneDigits && allowPhones.includes(userPhoneDigits)) ||
      (userPhoneLast11 && allowPhones.includes(userPhoneLast11)) ||
      (userEmail && allowEmails.includes(userEmail));

    const role = isAdmin ? "ADMIN" : "USER";

    const permissions = role === "ADMIN"
      ? [
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
        ]
      : [];

    return res.status(200).json({ success: true, data: user, role, permissions });
  } catch (error) {
    console.error("getProfile Error:", error);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};