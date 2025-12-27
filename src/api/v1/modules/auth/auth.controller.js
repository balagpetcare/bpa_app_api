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
    const phoneNorm = (phone || "").trim();

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
          emailNorm ? { email: emailNorm } : undefined,
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
    const phoneNorm = (phone || "").trim();

    if (!emailNorm && !phoneNorm) {
      return res.status(400).json({ success: false, message: "email or phone is required" });
    }

    if (!password) {
      return res.status(400).json({ success: false, message: "password is required" });
    }

    const authRow = await prisma.userAuth.findFirst({
      where: {
        OR: [
          emailNorm ? { email: emailNorm } : undefined,
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

    return res.status(200).json({ success: true, data: user });
  } catch (error) {
    console.error("getProfile Error:", error);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};
