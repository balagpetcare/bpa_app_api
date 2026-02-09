const jwt = require("jsonwebtoken");
const appConfig = require("../config/appConfig");
const { resolvePermissionsForUser } = require("../api/v1/utils/permissions");
const { attachAuthContexts } = require("../api/v1/services/authUnified.service");

/**
 * Auth middleware – identity + contexts.
 * req.user = identity (id, permissions, role for legacy)
 * req.contexts = AuthContext[] (canonical authorization model)
 */
module.exports = async function authenticateToken(req, res, next) {
  try {
    const cookieToken =
      (req.cookies && (req.cookies.access_token || req.cookies.token || req.cookies.jwt)) || null;
    const header = req.headers.authorization || "";
    const bearerToken = header.startsWith("Bearer ") ? header.slice(7) : null;
    const token = cookieToken || bearerToken;

    if (!token) {
      return res.status(401).json({ success: false, message: "Unauthorized: token missing" });
    }

    const payload = jwt.verify(token, appConfig.jwt.secret);
    const id =
      (payload && (payload.id || payload.userId)) ||
      (payload && payload.sub ? Number(payload.sub) : null);
    const userId = Number(id || 0);

    req.user = { ...(payload || {}), id: userId };
    if (payload && payload.userType) req.user.userType = payload.userType;

    const permsFromToken = (payload && (payload.perms || payload.permissions)) || null;
    if (Array.isArray(permsFromToken)) {
      req.user.permissions = permsFromToken;
    } else {
      try {
        req.user.permissions = await resolvePermissionsForUser(userId);
      } catch {
        req.user.permissions = [];
      }
    }

    await attachAuthContexts(req, userId);
    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: "Unauthorized: invalid token" });
  }
};

export {};
