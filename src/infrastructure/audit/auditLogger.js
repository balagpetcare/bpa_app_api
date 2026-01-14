const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'admin-audit.log');

function _safeJson(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return JSON.stringify({ error: 'non-serializable' });
  }
}

function logAdminAction({ req, action, targetType, targetId, meta }) {
  const line = {
    ts: new Date().toISOString(),
    action,
    targetType: targetType || null,
    targetId: targetId != null ? String(targetId) : null,
    adminUserId: req?.user?.id || null,
    ip:
      (req?.headers && (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'])) ||
      req?.ip ||
      null,
    ua: req?.headers ? req.headers['user-agent'] : null,
    requestId: req?.headers ? req.headers['x-request-id'] || null : null,
    meta: meta || null,
  };

  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, _safeJson(line) + '\n', { encoding: 'utf8' });
  } catch {
    // best-effort only
  }
}

module.exports = {
  logAdminAction,
};
