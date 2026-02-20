const prisma = require("../../../../infrastructure/db/prismaClient");
const jwt = require("jsonwebtoken");
const appConfig = require("../../../../config/appConfig");
const { performUnifiedLogin } = require("../../services/authUnified.service");

/**
 * POST /api/v1/admin/auth/login
 * Body: { email? or phone?, password }
 * Uses shared authUnified.service; rejects non-admin; returns canonical contexts + default_redirect.
 */
exports.login = async (req, res) => {
  try {
    const { email, phone, password } = req.body;

    let result;
    try {
      result = await performUnifiedLogin({
        email: email || null,
        phone: phone || null,
        password: password || "",
        options: { adminOnly: true },
      });
    } catch (authErr) {
      if (authErr.statusCode === 403) {
        const isProd = String(process.env.NODE_ENV || "development") === "production";
        res.clearCookie("access_token", {
          httpOnly: true,
          sameSite: "lax",
          secure: isProd,
          path: "/",
          domain: process.env.COOKIE_DOMAIN || "localhost",
        });
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
      const code = authErr.statusCode || 400;
      return res.status(code).json({ success: false, message: authErr.message || "Invalid credentials" });
    }

    const { authRow, user, contexts, default_redirect } = result;
    const token = jwt.sign({ id: user.id }, appConfig.jwt.secret, { expiresIn: "7d" });

    const isProd = String(process.env.NODE_ENV || "development") === "production";
    res.cookie("access_token", token, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: isProd, // false in dev so cookie works over http
      maxAge: 30 * 24 * 60 * 60 * 1000,
      domain: process.env.COOKIE_DOMAIN || "localhost",
    });

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        email: authRow?.email ?? user.auth?.email ?? null,
        phone: authRow?.phone ?? user.auth?.phone ?? null,
        displayName: user.profile?.displayName || null,
        username: user.profile?.username || null,
      },
      contexts,
      default_redirect,
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
      domain: process.env.COOKIE_DOMAIN || "localhost",
    });
    return res.status(200).json({ success: true, message: "Logged out" });
  } catch {
    return res.status(500).json({ success: false, message: "Logout failed" });
  }
};

export {};
