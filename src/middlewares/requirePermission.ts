function normalizePerms(perms: any): string[] {
  if (!Array.isArray(perms)) return [];
  return perms.map((p) => String(p));
}

function hasAny(perms: Set<string>, required: string[]) {
  return required.some((p) => perms.has(p));
}

function isDevEnv() {
  return String(process.env.NODE_ENV || "development") !== "production";
}

function requirePermission(...required: string[]) {
  return (req, res, next) => {
    try {
      if (!required.length) return next();
      // Whitelisted admin (passed requireAdmin) can access any admin.* permission
      if (req.user?.isWhitelistedAdmin && required.every((r) => String(r).startsWith("admin."))) return next();
      // Support both full permissions array and JWT compact perms
      const userPerms = req.user?.permissions || req.user?.perms;
      const perms = new Set(normalizePerms(userPerms));
      if (perms.has("global.admin") || perms.has("country.admin")) return next();
      if (hasAny(perms, required)) return next();
      if (isDevEnv()) {
        console.warn("[requirePermission] denied", {
          path: req.originalUrl || req.url,
          method: req.method,
          userId: req.user?.id ?? null,
          role: req.user?.role ?? null,
          roles: req.user?.roles ?? null,
          isWhitelistedAdmin: Boolean(req.user?.isWhitelistedAdmin),
          requiredPermissions: required,
          permissionCount: perms.size,
          samplePermissions: Array.from(perms).slice(0, 15),
        });
      }
      if (res && res.locals) {
        res.locals.requiredPermissions = required;
      }
      return res.status(403).json({
        success: false,
        message: "Permission denied",
        code: "MISSING_PERMISSION",
        requiredPermissions: required,
      });
    } catch (e) {
      return res.status(500).json({ success: false, message: "Permission guard failed" });
    }
  };
}

module.exports = requirePermission;
export { requirePermission };
