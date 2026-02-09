/**
 * Guard: require one of allowedRoles.
 * Checks req.user.role (legacy) OR req.contexts (canonical) so users with multiple
 * roles (e.g. admin+owner) can access role-specific routes.
 */
module.exports = function roleGuard(allowedRoles = []) {
  return (req, res, next) => {
    const role = req.user?.role;
    const hasRole = role && allowedRoles.includes(role);
    const hasContext = Array.isArray(req.contexts) && req.contexts.some((c) => allowedRoles.includes(c.role));
    if (hasRole || hasContext) return next();
    return res.status(403).json({ success: false, message: 'Forbidden' });
  };
};

export {};
