const jwt = require("jsonwebtoken");
const appConfig = require("../config/appConfig");
const prisma = require("../infrastructure/db/prismaClient");
const { attachAuthContexts } = require("../api/v1/services/authUnified.service");

/**
 * Auth middleware used across API modules (owner, branches, etc.).
 *
 * Supports: Cookie auth + Bearer auth.
 * Populates:
 *   req.user = { id, role (legacy), userType, ...payload }
 *   req.contexts = AuthContext[] (canonical authorization model)
 */
module.exports = async function auth(req, res, next) {
  try {
    const cookieToken =
      (req.cookies &&
        (req.cookies.access_token || req.cookies.token || req.cookies.jwt)) ||
      null;
    const header = req.headers.authorization || "";
    const bearerToken = header.startsWith("Bearer ") ? header.slice(7) : null;
    const token = cookieToken || bearerToken;

    if (!token) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized: token missing" });
    }

    const payload = jwt.verify(token, appConfig.jwt.secret);
    const id =
      (payload && (payload.id || payload.userId)) ||
      (payload && payload.sub ? Number(payload.sub) : null);
    const userId = Number(id || 0);

    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized: invalid token" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized: user not found" });
    }

    req.user = { ...(payload || {}), id: userId, userType: payload?.userType || null };
    await attachAuthContexts(req, userId);
    return next();
  } catch (e) {
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized: invalid token" });
  }
};

export {};
