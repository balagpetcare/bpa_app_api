const jwt = require("jsonwebtoken");
const appConfig = require("../config/appConfig");
const { resolvePermissionsForUser } = require("../api/v1/utils/permissions");

module.exports = function authenticateToken(req, res, next) {
  try {
    // ✅ 1) Try cookie first (JWT cookie) - keeps TailAdmin simple (credentials: include)
    const cookieToken =
      (req.cookies && (req.cookies.access_token || req.cookies.token || req.cookies.jwt)) || null;

    // ✅ 2) Fallback to Bearer token (existing clients)
    const header = req.headers.authorization || "";
    const bearerToken = header.startsWith("Bearer ") ? header.slice(7) : null;

    const token = cookieToken || bearerToken;

    if (!token) {
      return res.status(401).json({ success: false, message: "Unauthorized: token missing" });
    }

    const payload = jwt.verify(token, appConfig.jwt.secret);

    // Normalize common payload shapes
    const id =
      (payload && (payload.id || payload.userId)) ||
      (payload && payload.sub ? Number(payload.sub) : null);

    req.user = { ...(payload || {}), id: Number(id || payload.id || payload.userId) };

    // Extract userType from JWT if present (STAFF, OWNER, ADMIN, USER)
    if (payload && payload.userType) {
      req.user.userType = payload.userType;
    }

    // Attach permissions (from token payload if present, otherwise resolve from DB)
    const permsFromToken = (payload && (payload.perms || payload.permissions)) || null;
    if (Array.isArray(permsFromToken)) {
      req.user.permissions = permsFromToken;
    } else {
      // best-effort resolve (does not throw)
      resolvePermissionsForUser(req.user.id)
        .then((perms) => {
          req.user.permissions = perms;
          next();
        })
        .catch(() => {
          req.user.permissions = [];
          next();
        });
      return;
    }


    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: "Unauthorized: invalid token" });
  }
};

export {};
