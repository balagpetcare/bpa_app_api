/*
  auditWriter helper.
  Usage: await writeAudit({ prisma, req, action, entityType, entityId, before, after })
*/

function getIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.ip ||
    req.connection?.remoteAddress ||
    null
  );
}

async function writeAudit({ prisma, req, action, entityType, entityId, before, after }) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: String(req.user?.id || 'unknown'),
        actorRole: req.user?.role || 'STAFF',
        action: String(action),
        entityType,
        entityId: String(entityId),
        before: before ?? null,
        after: after ?? null,
        ip: getIp(req),
        userAgent: String(req.headers['user-agent'] || '') || null
      }
    });
  } catch (e) {
    // Audit failure shouldn't block core operation in most cases.
    // If you want strict mode, rethrow here.
    console.error('auditWriter error:', e?.message || e);
  }
}

module.exports = { writeAudit };

export {};
