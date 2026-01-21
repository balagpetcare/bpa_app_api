/**
 * TEMP auth middleware for development.
 * In production you will replace with JWT/session auth.
 *
 * Expect: x-user-id header.
 */
function requireUser(req, res, next) {
  const userId = req.header('x-user-id');
  if (!userId || Number.isNaN(Number(userId))) {
    return res.status(401).json({ success: false, message: 'Unauthorized: x-user-id required' });
  }
  req.auth = { userId: Number(userId) };
  next();
}

module.exports = { requireUser };

export {};
