function getPrisma(req) {
  if (!req.prisma) throw new Error('Prisma instance not found on req.prisma');
  return req.prisma;
}

function safeObj(v) {
  if (!v || typeof v !== 'object') return null;
  return v;
}

function buildDiff(before, after) {
  const b = safeObj(before) || {};
  const a = safeObj(after) || {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const changes = [];
  for (const k of keys) {
    const bv = b[k];
    const av = a[k];
    const same = JSON.stringify(bv) === JSON.stringify(av);
    if (!same) changes.push({ key: k, from: bv ?? null, to: av ?? null });
  }
  return changes;
}

exports.query = async (req, res) => {
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
              { entityId: { contains: q } },
              { entityType: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const rows = await prisma.auditLog.findMany({
      where,
      take,
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.diff = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const id = parseInt(String(req.params.id || ''), 10);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });

    const row = await prisma.auditLog.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ success: false, message: 'Not found' });

    const changes = buildDiff(row.before, row.after);
    res.json({ success: true, data: { row, changes } });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

export {};
