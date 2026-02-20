function normalizePerms(perms: any): string[] {
  if (!Array.isArray(perms)) return [];
  return perms.map((p) => String(p));
}

function hasAny(perms: Set<string>, required: string[]) {
  return required.some((p) => perms.has(p));
}

function requirePermission(...required: string[]) {
  return (req, res, next) => {
    try {
      if (!required.length) return next();
      // Support both full permissions array and JWT compact perms
      const userPerms = req.user?.permissions || req.user?.perms;
      const perms = new Set(normalizePerms(userPerms));
      if (perms.has("global.admin") || perms.has("country.admin")) return next();
      if (hasAny(perms, required)) return next();
      return res.status(403).json({ success: false, message: "Permission denied" });
    } catch (e) {
      return res.status(500).json({ success: false, message: "Permission guard failed" });
    }
  };
}

module.exports = requirePermission;
export { requirePermission };
