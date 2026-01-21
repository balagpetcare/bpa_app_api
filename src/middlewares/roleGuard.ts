module.exports = function roleGuard(allowedRoles = []) {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role || !allowedRoles.includes(role)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    next();
  };
};

export {};
