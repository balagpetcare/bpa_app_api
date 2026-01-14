const jwt = require("jsonwebtoken");
const appConfig = require("../config/appConfig");

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

    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: "Unauthorized: invalid token" });
  }
};
