function getPrisma(req) {
  if (!req.prisma) throw new Error('Prisma instance not found on req.prisma');
  return req.prisma;
}

exports.queryAudit = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const actorId = req.query.actorId ? String(req.query.actorId) : null;
    const entityType = req.query.entityType ? String(req.query.entityType) : null;
    const entityId = req.query.entityId ? String(req.query.entityId) : null;
    const q = req.query.q ? String(req.query.q).trim() : null;
    const take = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);

    const where = {
      ...(actorId ? { actorId } : {}),
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(q
        ? {
            OR: [
              { action: { contains: q, mode: 'insensitive' } },
              { entityId: { contains: q } }
            ]
          }
        : {})
    };

    const rows = await prisma.auditLog.findMany({
      where,
      take,
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

export {};
