/**
 * Guard: allow users who have owner-panel access (OWNER, ADMIN, or Staff/Team in context).
 * Use after auth. Replaces roleGuard(['OWNER','ADMIN']) so Staff/Team can use /owner/* with RBAC.
 */

module.exports = function ownerPanelGuard() {
  return (req: any, res: any, next: any) => {
    const role = req.user?.role;
    const allowedRoles = ["OWNER", "ADMIN", "STAFF", "TEAM"];
    const hasRole = role && allowedRoles.includes(role);
    const hasContext =
      Array.isArray(req.contexts) &&
      req.contexts.some((c: any) => allowedRoles.includes(c.role));
    if (hasRole || hasContext) return next();
    return res.status(403).json({
      success: false,
      message: "Forbidden",
      code: "ACCESS_DENIED",
      detail: "Owner panel access requires OWNER, ADMIN, STAFF, or TEAM context",
    });
  };
};

export {};
