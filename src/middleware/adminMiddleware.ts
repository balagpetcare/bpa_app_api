/**
 * Admin middleware
 * ----------------
 * This project does not store an explicit "role" on the User model (schema.prisma).
 * So admin access is controlled via environment variables:
 *
 * - ADMIN_USER_IDS: comma-separated user IDs that are allowed to access admin routes (e.g. "1,2,5")
 * - ADMIN_KEY: optional shared secret header for server-to-server/admin tooling
 *   Send it as: x-admin-key: <ADMIN_KEY>
 *
 * If neither is configured, all admin routes will be denied (secure-by-default).
 */
module.exports = async function adminMiddleware(req, res, next) {
  try {
    // Optional shared secret (useful for backoffice tools)
    const adminKey = process.env.ADMIN_KEY;
    if (adminKey) {
      const headerKey = req.headers["x-admin-key"];
      if (headerKey && String(headerKey) === String(adminKey)) return next();
    }

    // User-ID allowlist
    const raw = process.env.ADMIN_USER_IDS || "";
    const allowed = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n > 0);

    const userId = Number(req.user?.id);
    if (allowed.length > 0 && allowed.includes(userId)) return next();

    return res.status(403).json({ success: false, message: "Forbidden: admin only" });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Admin middleware error" });
  }
};

export {};
