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
    // VerificationStatus enum values: UNSUBMITTED, SUBMITTED, VERIFIED, REJECTED
    const ownerStatuses = ['UNSUBMITTED', 'SUBMITTED', 'VERIFIED', 'REJECTED'];
    const orgStatuses = ['UNSUBMITTED', 'SUBMITTED', 'VERIFIED', 'REJECTED'];
    const branchStatuses = ['UNSUBMITTED', 'SUBMITTED', 'VERIFIED', 'REJECTED'];

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

exports.getAnalytics = async (req, res) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisWeek = new Date(today);
    thisWeek.setDate(today.getDate() - today.getDay());
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);

    // Get total counts
    const [
      totalOwners,
      totalOrgs,
      totalBranches,
      totalUsers,
      totalProducts,
      totalOrders,
      totalStaff,
    ] = await Promise.all([
      prisma.ownerKyc.count().catch(() => 0),
      prisma.organization.count().catch(() => 0),
      prisma.branch.count().catch(() => 0),
      prisma.user.count().catch(() => 0),
      prisma.product.count().catch(() => 0),
      prisma.order.count({ where: { status: { not: 'CANCELLED' } } }).catch(() => 0),
      Promise.all([
        prisma.orgMember.count().catch(() => 0),
        prisma.branchMember.count().catch(() => 0),
      ]).then(([orgCount, branchCount]) => orgCount + branchCount).catch(() => 0),
    ]);

    // Get revenue data
    const [todayRevenue, weekRevenue, monthRevenue, lastMonthRevenue] = await Promise.all([
      prisma.order.aggregate({
        where: {
          createdAt: { gte: today },
          status: { not: 'CANCELLED' },
          paymentStatus: 'COMPLETED',
        },
        _sum: { totalAmount: true },
      }).catch(() => ({ _sum: { totalAmount: 0 } })),
      prisma.order.aggregate({
        where: {
          createdAt: { gte: thisWeek },
          status: { not: 'CANCELLED' },
          paymentStatus: 'COMPLETED',
        },
        _sum: { totalAmount: true },
      }).catch(() => ({ _sum: { totalAmount: 0 } })),
      prisma.order.aggregate({
        where: {
          createdAt: { gte: thisMonth },
          status: { not: 'CANCELLED' },
          paymentStatus: 'COMPLETED',
        },
        _sum: { totalAmount: true },
      }).catch(() => ({ _sum: { totalAmount: 0 } })),
      prisma.order.aggregate({
        where: {
          createdAt: { gte: lastMonth, lt: thisMonth },
          status: { not: 'CANCELLED' },
          paymentStatus: 'COMPLETED',
        },
        _sum: { totalAmount: true },
      }).catch(() => ({ _sum: { totalAmount: 0 } })),
    ]);

    // Get order counts
    const [todayOrders, weekOrders, monthOrders] = await Promise.all([
      prisma.order.count({
        where: {
          createdAt: { gte: today },
          status: { not: 'CANCELLED' },
        },
      }).catch(() => 0),
      prisma.order.count({
        where: {
          createdAt: { gte: thisWeek },
          status: { not: 'CANCELLED' },
        },
      }).catch(() => 0),
      prisma.order.count({
        where: {
          createdAt: { gte: thisMonth },
          status: { not: 'CANCELLED' },
        },
      }).catch(() => 0),
    ]);

    // Get new registrations
    const [todayUsers, weekUsers, monthUsers] = await Promise.all([
      prisma.user.count({ where: { createdAt: { gte: today } } }).catch(() => 0),
      prisma.user.count({ where: { createdAt: { gte: thisWeek } } }).catch(() => 0),
      prisma.user.count({ where: { createdAt: { gte: thisMonth } } }).catch(() => 0),
    ]);

    return res.json({
      success: true,
      data: {
        totals: {
          owners: totalOwners,
          organizations: totalOrgs,
          branches: totalBranches,
          users: totalUsers,
          products: totalProducts,
          orders: totalOrders,
          staff: totalStaff,
        },
        revenue: {
          today: parseFloat(todayRevenue._sum.totalAmount?.toString() || '0'),
          week: parseFloat(weekRevenue._sum.totalAmount?.toString() || '0'),
          month: parseFloat(monthRevenue._sum.totalAmount?.toString() || '0'),
          lastMonth: parseFloat(lastMonthRevenue._sum.totalAmount?.toString() || '0'),
        },
        orders: {
          today: todayOrders,
          week: weekOrders,
          month: monthOrders,
        },
        users: {
          today: todayUsers,
          week: weekUsers,
          month: monthUsers,
        },
      },
    });
  } catch (e) {
    console.error('admin dashboard analytics error', e);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.getRevenue = async (req, res) => {
  try {
    const period = req.query.period || 'month'; // day, week, month
    const now = new Date();
    let startDate = new Date();

    if (period === 'day') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'week') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const orders = await prisma.order.findMany({
      where: {
        createdAt: { gte: startDate },
        status: { not: 'CANCELLED' },
        paymentStatus: 'COMPLETED',
      },
      select: {
        totalAmount: true,
        createdAt: true,
        paymentMethod: true,
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Group by date
    const byDate: Record<string, { date: string; revenue: number; orders: number }> = {};
    orders.forEach((order) => {
      const dateKey = order.createdAt.toISOString().split('T')[0];
      if (!byDate[dateKey]) {
        byDate[dateKey] = { date: dateKey, revenue: 0, orders: 0 };
      }
      byDate[dateKey].revenue += parseFloat(order.totalAmount.toString());
      byDate[dateKey].orders += 1;
    });

    // Group by branch
    const byBranch: Record<string, { branchId: string; branchName: string; revenue: number; orders: number }> = {};
    orders.forEach((order) => {
      const branchId = order.branch?.id || 'unknown';
      const branchName = order.branch?.name || 'Unknown';
      if (!byBranch[branchId]) {
        byBranch[branchId] = { branchId, branchName, revenue: 0, orders: 0 };
      }
      byBranch[branchId].revenue += parseFloat(order.totalAmount.toString());
      byBranch[branchId].orders += 1;
    });

    const totalRevenue = orders.reduce((sum, order) => sum + parseFloat(order.totalAmount.toString()), 0);

    return res.json({
      success: true,
      data: {
        totalRevenue,
        totalOrders: orders.length,
        byDate: Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)),
        byBranch: Object.values(byBranch).sort((a, b) => b.revenue - a.revenue),
      },
    });
  } catch (e) {
    console.error('admin dashboard revenue error', e);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.getActivity = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;

    // Get recent activities from various sources
    const [recentVerifications, recentOrders, recentUsers] = await Promise.all([
      prisma.ownerKyc.findMany({
        orderBy: { updatedAt: 'desc' },
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              auth: { select: { phone: true, email: true } },
            },
          },
        },
      }).catch(() => []),
      prisma.order.findMany({
        where: { status: { not: 'CANCELLED' } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          branch: { select: { id: true, name: true } },
        },
      }).catch(() => []),
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          auth: { select: { phone: true, email: true } },
        },
      }).catch(() => []),
    ]);

    // Combine and sort by date
    const activities = [
      ...recentVerifications.map((v) => ({
        type: 'verification',
        id: v.id,
        title: `Owner KYC ${v.verificationStatus}`,
        description: `User #${v.userId}`,
        date: v.updatedAt,
        status: v.verificationStatus,
      })),
      ...recentOrders.map((o) => ({
        type: 'order',
        id: o.id,
        title: `Order #${o.id}`,
        description: `${o.branch?.name || 'Unknown Branch'} - ${o.totalAmount}`,
        date: o.createdAt,
        status: o.status,
      })),
      ...recentUsers.map((u) => ({
        type: 'user',
        id: u.id,
        title: `New User #${u.id}`,
        description: u.auth?.phone || u.auth?.email || 'No contact',
        date: u.createdAt,
        status: 'ACTIVE',
      })),
    ]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, limit);

    return res.json({
      success: true,
      data: activities,
    });
  } catch (e) {
    console.error('admin dashboard activity error', e);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

/**
 * Live Operations Monitor feed: recent orders, verification submissions, deliveries, withdraw requests.
 */
exports.getLiveFeed = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const eventType = req.query.eventType; // order | verification | delivery | ticket | withdraw

    const [orders, verificationCases, withdraws, users] = await Promise.all([
      prisma.order.findMany({
        where: { status: { not: 'CANCELLED' } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          orderNumber: true,
          totalAmount: true,
          status: true,
          createdAt: true,
          branch: { select: { id: true, name: true } },
        },
      }).catch(() => []),
      prisma.verificationCase.findMany({
        where: { status: 'SUBMITTED' },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          entityType: true,
          entityId: true,
          status: true,
          submittedAt: true,
          createdAt: true,
        },
      }).catch(() => []),
      prisma.walletWithdrawRequest.findMany({
        where: { status: 'SUBMITTED' },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        select: { id: true, amount: true, status: true, createdAt: true, updatedAt: true },
      }).catch(() => []),
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: Math.floor(limit / 3),
        select: { id: true, createdAt: true, auth: { select: { phone: true, email: true } } },
      }).catch(() => []),
    ]);

    const feed = [
      ...orders.map((o) => ({
        eventType: 'order',
        id: `order-${o.id}`,
        title: `Order #${o.orderNumber}`,
        description: `${o.branch?.name || 'Branch'} · ${parseFloat(o.totalAmount?.toString() || '0').toLocaleString()} BDT`,
        date: o.createdAt,
        meta: { orderId: o.id, status: o.status },
      })),
      ...verificationCases.map((vc) => ({
        eventType: 'verification',
        id: `vc-${vc.id}`,
        title: `${vc.entityType} verification submitted`,
        description: `Case #${vc.id} (${vc.entityType})`,
        date: vc.submittedAt ?? vc.createdAt,
        meta: { caseId: vc.id, entityType: vc.entityType, entityId: vc.entityId },
      })),
      ...withdraws.map((w) => ({
        eventType: 'withdraw',
        id: `withdraw-${w.id}`,
        title: `Withdraw request #${w.id}`,
        description: `${parseFloat(w.amount?.toString() || '0').toLocaleString()} BDT`,
        date: w.updatedAt || w.createdAt,
        meta: { withdrawId: w.id, status: w.status },
      })),
      ...users.slice(0, 5).map((u) => ({
        eventType: 'user',
        id: `user-${u.id}`,
        title: `New user #${u.id}`,
        description: u.auth?.phone || u.auth?.email || 'No contact',
        date: u.createdAt,
        meta: { userId: u.id },
      })),
    ]
      .filter((e) => !eventType || e.eventType === eventType)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, limit);

    return res.json({ success: true, data: feed });
  } catch (e) {
    console.error('admin dashboard live-feed error', e);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

/**
 * Operational alerts: payment failures, verification overdue, refund spike, stock expiry, system health.
 */
exports.getAlerts = async (req, res) => {
  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const overdueThreshold = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    const [
      paymentFailedCount,
      verificationOverdue,
      withdrawSubmittedCount,
      verificationSubmittedCount,
    ] = await Promise.all([
      prisma.order.count({
        where: {
          createdAt: { gte: last24h },
          paymentStatus: 'FAILED',
        },
      }).catch(() => 0),
      prisma.verificationCase.count({
        where: {
          status: 'SUBMITTED',
          submittedAt: { lt: overdueThreshold },
        },
      }).catch(() => 0),
      prisma.walletWithdrawRequest.count({ where: { status: 'SUBMITTED' } }).catch(() => 0),
      prisma.verificationCase.count({ where: { status: 'SUBMITTED' } }).catch(() => 0),
    ]);

    const alerts = [];
    if (paymentFailedCount > 0) {
      alerts.push({
        id: 'payment-failures',
        severity: 'high',
        title: 'Payment failures (24h)',
        description: `${paymentFailedCount} order(s) with failed payment.`,
        actionHref: '/admin/orders?paymentStatus=FAILED',
      });
    }
    if (verificationOverdue > 0) {
      alerts.push({
        id: 'verification-overdue',
        severity: 'high',
        title: 'Verifications overdue',
        description: `${verificationOverdue} case(s) submitted >48h ago still pending.`,
        actionHref: '/admin/verifications',
      });
    }
    if (withdrawSubmittedCount > 5) {
      alerts.push({
        id: 'withdraw-queue',
        severity: 'medium',
        title: 'Withdraw queue building',
        description: `${withdrawSubmittedCount} withdraw request(s) pending.`,
        actionHref: '/admin/wallet',
      });
    }
    if (verificationSubmittedCount > 10) {
      alerts.push({
        id: 'verification-backlog',
        severity: 'medium',
        title: 'Verification backlog',
        description: `${verificationSubmittedCount} case(s) awaiting review.`,
        actionHref: '/admin/verifications',
      });
    }
    if (alerts.length === 0) {
      alerts.push({
        id: 'all-clear',
        severity: 'info',
        title: 'No critical alerts',
        description: 'All systems operating normally.',
        actionHref: null,
      });
    }

    return res.json({ success: true, data: alerts });
  } catch (e) {
    console.error('admin dashboard alerts error', e);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

/**
 * SLA metrics: avg verification time, ticket response time (placeholder), delivery on-time % (placeholder).
 */
exports.getSla = async (req, res) => {
  try {
    const completed = await prisma.verificationCase.findMany({
      where: {
        status: { in: ['APPROVED', 'REJECTED'] },
        submittedAt: { not: null },
        reviewedAt: { not: null },
      },
      select: {
        submittedAt: true,
        reviewedAt: true,
      },
    }).catch(() => []);

    let avgVerificationHours = 0;
    if (completed.length > 0) {
      const totalMs = completed.reduce((acc, c) => {
        const sub = new Date(c.submittedAt).getTime();
        const rev = new Date(c.reviewedAt).getTime();
        return acc + (rev - sub);
      }, 0);
      avgVerificationHours = Math.round((totalMs / completed.length) / (60 * 60 * 1000) * 10) / 10;
    }

    const pendingCount = await prisma.verificationCase.count({
      where: { status: 'SUBMITTED' },
    }).catch(() => 0);

    return res.json({
      success: true,
      data: {
        avgVerificationHours,
        verificationPendingCount: pendingCount,
        ticketAvgResponseHours: null,
        deliveryOnTimePercent: null,
      },
    });
  } catch (e) {
    console.error('admin dashboard sla error', e);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

/**
 * Trend data for charts: Orders+GMV (7/30 days), New users/owners (7/30 days).
 */
exports.getTrends = async (req, res) => {
  try {
    const period = req.query.period === '30' ? 30 : 7;
    const start = new Date();
    start.setDate(start.getDate() - period);
    start.setHours(0, 0, 0, 0);

    const [orders, users, owners] = await Promise.all([
      prisma.order.findMany({
        where: {
          createdAt: { gte: start },
          status: { not: 'CANCELLED' },
        },
        select: { totalAmount: true, paymentStatus: true, createdAt: true },
      }).catch(() => []),
      prisma.user.findMany({
        where: { createdAt: { gte: start } },
        select: { createdAt: true },
      }).catch(() => []),
      prisma.ownerKyc.findMany({
        where: { createdAt: { gte: start } },
        select: { createdAt: true },
      }).catch(() => []),
    ]);

    type DayRow = { date: string; orders: number; gmv: number; users: number; owners: number };
    const byDate: Record<string, DayRow> = {};
    for (let i = 0; i < period; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const k = d.toISOString().split('T')[0];
      byDate[k] = { date: k, orders: 0, gmv: 0, users: 0, owners: 0 };
    }

    orders.forEach((o) => {
      const k = o.createdAt.toISOString().split('T')[0];
      if (!byDate[k]) byDate[k] = { date: k, orders: 0, gmv: 0, users: 0, owners: 0 };
      byDate[k].orders += 1;
      if (o.paymentStatus === 'COMPLETED') {
        byDate[k].gmv += parseFloat(o.totalAmount?.toString() || '0');
      }
    });
    users.forEach((u) => {
      const k = u.createdAt.toISOString().split('T')[0];
      if (byDate[k]) byDate[k].users += 1;
    });
    owners.forEach((o) => {
      const k = o.createdAt.toISOString().split('T')[0];
      if (byDate[k]) byDate[k].owners += 1;
    });

    const series = Object.values(byDate).sort((a, b) => (a as DayRow).date.localeCompare((b as DayRow).date));

    return res.json({
      success: true,
      data: {
        period,
        series,
      },
    });
  } catch (e) {
    console.error('admin dashboard trends error', e);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export {};
