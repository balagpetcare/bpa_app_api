const prisma = require('../../../../infrastructure/db/prismaClient');

// Helper: count by status for a model that has `verificationStatus`
async function countByStatus(modelName, statuses) {
  const out = {};
  for (const s of statuses) {
    out[s] = await prisma[modelName].count({ where: { verificationStatus: s } });
  }
  return out;
}

exports.getSummary = async (req, res) => {
  try {
    const ownerStatuses = ['SUBMITTED', 'REQUEST_CHANGES', 'VERIFIED', 'REJECTED', 'SUSPENDED', 'UNSUBMITTED'];
    const orgStatuses = ['SUBMITTED', 'REQUEST_CHANGES', 'VERIFIED', 'REJECTED', 'SUSPENDED', 'UNSUBMITTED'];
    const branchStatuses = ['SUBMITTED', 'REQUEST_CHANGES', 'VERIFIED', 'REJECTED', 'SUSPENDED', 'UNSUBMITTED'];

    const [
      owners,
      organizations,
      branches,
      withdrawSubmitted,
      withdrawReview,
    ] = await Promise.all([
      countByStatus('ownerKyc', ownerStatuses).catch(() => ({})),
      countByStatus('organizationLegalProfile', orgStatuses).catch(() => ({})),
      countByStatus('branchProfileDetails', branchStatuses).catch(() => ({})),
      prisma.walletWithdrawRequest.count({ where: { status: 'SUBMITTED' } }).catch(() => 0),
      prisma.walletWithdrawRequest.count({ where: { status: 'UNDER_REVIEW' } }).catch(() => 0),
    ]);

    return res.json({
      success: true,
      data: {
        owners,
        organizations,
        branches,
        wallet: {
          withdrawSubmitted,
          withdrawUnderReview: withdrawReview,
        },
      },
    });
  } catch (e) {
    console.error('admin dashboard summary error', e);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.getQueues = async (req, res) => {
  try {
    // lightweight queues (top 10 each)
    const [ownerQueue, orgQueue, branchQueue] = await Promise.all([
      prisma.ownerKyc.findMany({
        where: { verificationStatus: 'SUBMITTED' },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        include: { user: { select: { id: true, auth: true } } },
      }).catch(() => []),
      prisma.organizationLegalProfile.findMany({
        where: { verificationStatus: 'SUBMITTED' },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        include: { organization: { select: { id: true, name: true, ownerUserId: true } } },
      }).catch(() => []),
      prisma.branchProfileDetails.findMany({
        where: { verificationStatus: 'SUBMITTED' },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        include: { branch: { select: { id: true, name: true, orgId: true } } },
      }).catch(() => []),
    ]);

    return res.json({
      success: true,
      data: {
        ownerQueue,
        orgQueue,
        branchQueue,
      },
    });
  } catch (e) {
    console.error('admin dashboard queues error', e);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export {};
