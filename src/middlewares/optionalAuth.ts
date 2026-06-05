const jwt = require("jsonwebtoken");
const appConfig = require("../config/appConfig");
const prisma = require("../infrastructure/db/prismaClient");

/**
 * Optional auth middleware.
 * - Cookie/bearer JWT → req.user
 * - ?token= FILE_VIEW JWT → req.fileViewAuth (for <img src="/api/v1/files/...?token=">)
 * - Missing/invalid: continues without blocking
 */
module.exports = async function optionalAuth(req, _res, next) {
  try {
    const queryToken = req.query?.token ? String(req.query.token) : null;
    if (queryToken) {
      try {
        const payload = jwt.verify(queryToken, appConfig.jwt.secret);
        if (payload?.purpose === "FILE_VIEW" && payload?.fileKey && payload?.userId) {
          req.fileViewAuth = {
            fileKey: String(payload.fileKey),
            userId: Number(payload.userId),
            role: payload.role ? String(payload.role).toUpperCase() : null,
          };
        }
      } catch (_e) {
        /* invalid query token — fall through to cookie/bearer */
      }
    }

    const cookieToken =
      (req.cookies &&
        (req.cookies.access_token || req.cookies.token || req.cookies.jwt)) ||
      null;

    const header = req.headers.authorization || "";
    const bearerToken = header.startsWith("Bearer ") ? header.slice(7) : null;

    const token = cookieToken || bearerToken;
    if (!token) return next();

    const payload = jwt.verify(token, appConfig.jwt.secret);

    const id =
      (payload && (payload.id || payload.userId)) ||
      (payload && payload.sub ? Number(payload.sub) : null);

    const userId = Number(id || 0);
    if (!userId) return next();

    let role = payload?.role ? String(payload.role).toUpperCase() : null;
    if (!role) {
      const allowIds = String(process.env.ADMIN_USER_IDS || "")
        .split(",")
        .map((x) => Number(String(x).trim()))
        .filter(Boolean);
      role = allowIds.includes(userId) ? "ADMIN" : "OWNER";
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) return next();

    req.user = { ...(payload || {}), id: userId, role };
    return next();
  } catch (_e) {
    return next();
  }
};

export {};
