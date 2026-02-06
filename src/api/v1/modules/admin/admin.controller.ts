const { writeAudit } = require('../../../../middlewares/auditWriter');
const metricsSvc = require('../../services/verificationMetrics.service');

function getPrisma(req) {
  if (!req.prisma) throw new Error('Prisma instance not found on req.prisma');
  return req.prisma;
}

function normalizeEntityType(raw) {
  const v = String(raw || '').toUpperCase();
  // Keep backwards compatibility with existing admin review flow,
  // but allow metrics filters to include OWNER (universal verification).
  if (!['ORGANIZATION', 'BRANCH', 'OWNER', 'OWNER_KYC'].includes(v)) return null;
  return v;
}

async function loadEntity(prisma, entityType, id) {
  if (entityType === 'ORGANIZATION') return prisma.organization.findUnique({ where: { id } });
  if (entityType === 'BRANCH') return prisma.branch.findUnique({ where: { id } });
  // OWNER_KYC placeholder - implement when you have model
  return null;
}

async function updateEntityStatus(prisma, entityType, id, status) {
  if (entityType === 'ORGANIZATION') return prisma.organization.update({ where: { id }, data: { status } });
  if (entityType === 'BRANCH') {
    // Branch.status is BranchStatus enum: DRAFT | PENDING_REVIEW | ACTIVE | INACTIVE | BLOCKED
    // But the review flow historically used APPROVED/REJECTED.
    const incoming = String(status || '').toUpperCase().trim();
    const mapped = incoming === 'APPROVED' ? 'ACTIVE' : incoming === 'REJECTED' ? 'BLOCKED' : incoming;
    return prisma.branch.update({ where: { id }, data: { status: mapped } });
  }
  return null;
}

exports.listReviewQueue = async (req, res) => {
  try {
    const prisma = getPrisma(req);

    const entityType = req.query.type ? normalizeEntityType(req.query.type) : null;
    const status = req.query.status ? String(req.query.status) : 'PENDING_REVIEW';
    const q = String(req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 100);

    const where = {
      status,
      ...(entityType ? { entityType } : {}),
      ...(q
        ? {
            OR: [
              { entityId: { contains: q } },
              { rejectReason: { contains: q, mode: 'insensitive' } },
              { cancelReason: { contains: q, mode: 'insensitive' } }
            ]
          }
        : {})
    };

    const rows = await prisma.verification.findMany({
      where,
      take: limit,
      orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }]
    });

    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.getReviewItem = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const entityType = normalizeEntityType(req.params.entityType);
    const id = String(req.params.id);

    if (!entityType) return res.status(400).json({ success: false, message: 'Invalid entityType' });

    const entity = await loadEntity(prisma, entityType, id);
    if (!entity) return res.status(404).json({ success: false, message: 'Entity not found' });

    const history = await prisma.verification.findMany({
      where: { entityType, entityId: id },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: { entityType, entity, history } });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.approveItem = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const entityType = normalizeEntityType(req.params.entityType);
    const id = String(req.params.id);

    if (!entityType) return res.status(400).json({ success: false, message: 'Invalid entityType' });

    const before = await loadEntity(prisma, entityType, id);
    if (!before) return res.status(404).json({ success: false, message: 'Entity not found' });

    const updated = await updateEntityStatus(prisma, entityType, id, 'APPROVED');

    await prisma.verification.create({
      data: {
        entityType,
        entityId: id,
        status: 'APPROVED',
        reviewedAt: new Date(),
        reviewerId: String(req.user.id),
        ...(entityType === 'ORGANIZATION' ? { organizationId: id } : {}),
        ...(entityType === 'BRANCH' ? { branchId: id } : {})
      }
    });

    await writeAudit({ prisma, req, action: 'ADMIN_APPROVE', entityType, entityId: id, before, after: updated });

    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.rejectItem = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const entityType = normalizeEntityType(req.params.entityType);
    const id = String(req.params.id);
    const reason = req.body?.reason ? String(req.body.reason).trim() : '';

    if (!entityType) return res.status(400).json({ success: false, message: 'Invalid entityType' });
    if (!reason) return res.status(400).json({ success: false, message: 'reason is required' });

    const before = await loadEntity(prisma, entityType, id);
    if (!before) return res.status(404).json({ success: false, message: 'Entity not found' });

    const updated = await updateEntityStatus(prisma, entityType, id, 'REJECTED');

    await prisma.verification.create({
      data: {
        entityType,
        entityId: id,
        status: 'REJECTED',
        rejectReason: reason,
        reviewedAt: new Date(),
        reviewerId: String(req.user.id),
        ...(entityType === 'ORGANIZATION' ? { organizationId: id } : {}),
        ...(entityType === 'BRANCH' ? { branchId: id } : {})
      }
    });

    await writeAudit({ prisma, req, action: 'ADMIN_REJECT', entityType, entityId: id, before, after: updated });

    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.suspendItem = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const entityType = normalizeEntityType(req.params.entityType);
    const id = String(req.params.id);

    if (!entityType) return res.status(400).json({ success: false, message: 'Invalid entityType' });

    const before = await loadEntity(prisma, entityType, id);
    if (!before) return res.status(404).json({ success: false, message: 'Entity not found' });

    const updated = await updateEntityStatus(prisma, entityType, id, 'SUSPENDED');

    await prisma.verification.create({
      data: {
        entityType,
        entityId: id,
        status: 'SUSPENDED',
        reviewedAt: new Date(),
        reviewerId: String(req.user.id),
        ...(entityType === 'ORGANIZATION' ? { organizationId: id } : {}),
        ...(entityType === 'BRANCH' ? { branchId: id } : {})
      }
    });

    await writeAudit({ prisma, req, action: 'ADMIN_SUSPEND', entityType, entityId: id, before, after: updated });

    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.reinstateItem = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const entityType = normalizeEntityType(req.params.entityType);
    const id = String(req.params.id);

    if (!entityType) return res.status(400).json({ success: false, message: 'Invalid entityType' });

    const before = await loadEntity(prisma, entityType, id);
    if (!before) return res.status(404).json({ success: false, message: 'Entity not found' });

    // default back to APPROVED
    const updated = await updateEntityStatus(prisma, entityType, id, 'APPROVED');

    await prisma.verification.create({
      data: {
        entityType,
        entityId: id,
        status: 'APPROVED',
        reviewedAt: new Date(),
        reviewerId: String(req.user.id),
        ...(entityType === 'ORGANIZATION' ? { organizationId: id } : {}),
        ...(entityType === 'BRANCH' ? { branchId: id } : {})
      }
    });

    await writeAudit({ prisma, req, action: 'ADMIN_REINSTATE', entityType, entityId: id, before, after: updated });

    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.bulkApprove = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ success: false, message: 'items[] required' });

    const results = [];
    for (const it of items) {
      const entityType = normalizeEntityType(it.entityType);
      const id = String(it.id || '');
      if (!entityType || !id) continue;
      const before = await loadEntity(prisma, entityType, id);
      if (!before) continue;
      const updated = await updateEntityStatus(prisma, entityType, id, 'APPROVED');
      await prisma.verification.create({
        data: {
          entityType,
          entityId: id,
          status: 'APPROVED',
          reviewedAt: new Date(),
          reviewerId: String(req.user.id),
          ...(entityType === 'ORGANIZATION' ? { organizationId: id } : {}),
          ...(entityType === 'BRANCH' ? { branchId: id } : {})
        }
      });
      await writeAudit({ prisma, req, action: 'ADMIN_BULK_APPROVE', entityType, entityId: id, before, after: updated });
      results.push({ entityType, id, ok: true });
    }

    res.json({ success: true, data: results });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.bulkReject = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const reason = req.body?.reason ? String(req.body.reason).trim() : '';
    if (!items.length) return res.status(400).json({ success: false, message: 'items[] required' });
    if (!reason) return res.status(400).json({ success: false, message: 'reason required' });

    const results = [];
    for (const it of items) {
      const entityType = normalizeEntityType(it.entityType);
      const id = String(it.id || '');
      if (!entityType || !id) continue;
      const before = await loadEntity(prisma, entityType, id);
      if (!before) continue;
      const updated = await updateEntityStatus(prisma, entityType, id, 'REJECTED');
      await prisma.verification.create({
        data: {
          entityType,
          entityId: id,
          status: 'REJECTED',
          rejectReason: reason,
          reviewedAt: new Date(),
          reviewerId: String(req.user.id),
          ...(entityType === 'ORGANIZATION' ? { organizationId: id } : {}),
          ...(entityType === 'BRANCH' ? { branchId: id } : {})
        }
      });
      await writeAudit({ prisma, req, action: 'ADMIN_BULK_REJECT', entityType, entityId: id, before, after: updated });
      results.push({ entityType, id, ok: true });
    }

    res.json({ success: true, data: results });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

// ----------------------------
// V3.4: Monitoring (soft-mode compatible)
// ----------------------------

exports.listLockedUpdateAttempts = async (req, res) => {
  try {
    const prisma = getPrisma(req);

    const days = Math.min(parseInt(req.query.days || '7', 10) || 7, 90);
    const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);
    const entityType = req.query.entityType ? normalizeEntityType(req.query.entityType) : null;
    const entityId = req.query.entityId ? parseInt(String(req.query.entityId), 10) : null;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const where = {
      createdAt: { gte: since },
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
    };

    const rows = await prisma.verificationLockedUpdateAttempt.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        userId: true,
        entityType: true,
        entityId: true,
        reason: true,
        endpoint: true,
        method: true,
        ip: true,
        userAgent: true,
        createdAt: true,
      },
    });

    res.json({ success: true, data: rows, meta: { days, limit, since } });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

// V3.5: Monitoring summary endpoints (soft-mode compatible)
exports.getLockedUpdateAttemptsSummary = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const days = Math.min(parseInt(req.query.days || '7', 10) || 7, 90);
    const top = Math.min(parseInt(req.query.top || '10', 10) || 10, 50);
    const entityType = req.query.entityType ? normalizeEntityType(req.query.entityType) : null;

    const out = await metricsSvc.summaryLockedUpdateAttempts({ prisma, days, entityType, top });
    if (!out.ok) return res.status(500).json({ success: false, message: out.message || 'summary failed' });

    return res.json({ success: true, data: out });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.getLockedUpdateAttemptsTimeseries = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const days = Math.min(parseInt(req.query.days || '30', 10) || 30, 90);
    const entityType = req.query.entityType ? normalizeEntityType(req.query.entityType) : null;

    const out = await metricsSvc.timeseriesLockedUpdateAttempts({ prisma, days, entityType });
    if (!out.ok) return res.status(500).json({ success: false, message: out.message || 'timeseries failed' });

    return res.json({ success: true, data: out });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.getLockedUpdateAttemptsTopEntities = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const days = Math.min(parseInt(req.query.days || '7', 10) || 7, 90);
    const limit = Math.min(parseInt(req.query.limit || '10', 10) || 10, 100);
    const entityType = req.query.entityType ? normalizeEntityType(req.query.entityType) : null;

    const out = await metricsSvc.topEntitiesLockedUpdateAttempts({ prisma, days, entityType, limit });
    if (!out.ok) return res.status(500).json({ success: false, message: out.message || 'top entities failed' });

    return res.json({ success: true, data: out });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

export {};
