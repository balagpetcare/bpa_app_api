/**
 * Admin 2FA (TOTP) middleware
 * --------------------------
 * Enforces a TOTP code on sensitive admin routes.
 *
 * Env:
 * - ADMIN_2FA_REQUIRED=true|false (default: false)
 * - ADMIN_2FA_TOTP_SECRET=<base32 secret>
 *
 * Header:
 * - x-admin-otp: 6-digit code
 */

const { authenticator } = require('otplib');

module.exports = function admin2faMiddleware(req, res, next) {
  try {
    const required = String(process.env.ADMIN_2FA_REQUIRED || 'false').toLowerCase() === 'true';
    if (!required) return next();

    const secret = process.env.ADMIN_2FA_TOTP_SECRET;
    if (!secret) {
      return res.status(500).json({
        success: false,
        message: 'Admin 2FA is required but ADMIN_2FA_TOTP_SECRET is not configured',
      });
    }

    const code = String(req.headers['x-admin-otp'] || '').trim();
    if (!code) {
      return res.status(401).json({ success: false, message: 'Admin OTP required (x-admin-otp)' });
    }

    const ok = authenticator.check(code, secret);
    if (!ok) return res.status(401).json({ success: false, message: 'Invalid admin OTP' });

    return next();
  } catch {
    return res.status(500).json({ success: false, message: 'Admin 2FA middleware error' });
  }
};
