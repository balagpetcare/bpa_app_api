const jwt = require("jsonwebtoken");
const appConfig = require("../config/appConfig");
const prisma = require("../infrastructure/db/prismaClient");

/**
 * Auth middleware used across API modules.
 *
 * Supports:
 * - Cookie auth: access_token / token / jwt (recommended for Next.js panels with credentials: include)
 * - Bearer auth: Authorization: Bearer <token> (keeps Flutter/other clients working)
 *
 * Populates:
 *   req.user = { id: number, role: 'OWNER'|'ADMIN'|'SUPER_ADMIN'|'USER', ...payload }
 */
module.exports = async function auth(req, res, next) {
  try {
    // 1) Cookie token
    const cookieToken =
      (req.cookies &&
        (req.cookies.access_token || req.cookies.token || req.cookies.jwt)) ||
      null;

    // 2) Bearer token
    const header = req.headers.authorization || "";
    const bearerToken = header.startsWith("Bearer ") ? header.slice(7) : null;

    const token = cookieToken || bearerToken;
    if (!token) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized: token missing" });
    }

    const payload = jwt.verify(token, appConfig.jwt.secret);

    // Normalize common payload shapes
    const id =
      (payload && (payload.id || payload.userId)) ||
      (payload && payload.sub ? Number(payload.sub) : null);

    const userId = Number(id || 0);
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized: invalid token" });
    }

    // Determine role.
    // - If token already contains role, trust it.
    // - Else infer ADMIN from allowlist.
    // - Otherwise default to OWNER so any logged-in user can onboard as an owner.
    let role = payload?.role ? String(payload.role).toUpperCase() : null;

    if (!role) {
      const allowIds = String(process.env.ADMIN_USER_IDS || "")
        .split(",")
        .map((x) => Number(String(x).trim()))
        .filter(Boolean);

      const isAdmin = allowIds.includes(userId);
      role = isAdmin ? "ADMIN" : "OWNER";
    }

    // Optional: ensure user exists (avoids orphan tokens)
    // and keeps req.user consistent.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized: user not found" });
    }

    req.user = { ...(payload || {}), id: userId, role };
    return next();
  } catch (e) {
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized: invalid token" });
  }
};

export {};
