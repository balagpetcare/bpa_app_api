const prisma = require('../../../../infrastructure/db/prismaClient');

function normalizeCampaignStatus(status) {
  const s = String(status || '').toUpperCase();
  const allowed = ['ACTIVE', 'PAUSED', 'ENDED'];
  return allowed.includes(s) ? s : null;
}

function parseIntSafe(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

async function getFeed({ limit = 50, cursor, verified, sort }) {
  const take = Math.min(parseIntSafe(limit, 50), 100);
  const where = { deletedAt: null };

  if (verified !== undefined) {
    const b = String(verified).toLowerCase();
    if (b === 'true' || b === '1') where.account = { status: 'VERIFIED', deletedAt: null };
    if (b === 'false' || b === '0') where.account = { status: { not: 'VERIFIED' }, deletedAt: null };
  }

  let orderBy = { createdAt: 'desc' };
  const s = String(sort || '').toUpperCase();
  if (s === 'NEW') orderBy = { createdAt: 'desc' };
  if (s === 'TOP_DONATED') orderBy = { stats: { raisedAmount: 'desc' } };

  const args = {
    where,
    take,
    orderBy,
    include: {
      post: {
        include: {
          author: { select: { id: true, profile: { select: { displayName: true, username: true, avatarMedia: { select: { url: true } } } } } },
          media: { orderBy: { order: 'asc' }, include: { media: { select: { id: true, url: true, type: true } } } },
        },
      },
      account: { select: { id: true, status: true, userId: true } },
      stats: true,
    },
  };

  if (cursor) {
    args.skip = 1;
    args.cursor = { id: parseIntSafe(cursor) };
  }

  const list = await prisma.fundraisingCampaign.findMany(args);
  return list;
}

async function getCampaign({ id }) {
  const campaign = await prisma.fundraisingCampaign.findFirst({
    where: { id: parseIntSafe(id), deletedAt: null },
    include: {
      post: {
        include: {
          author: { select: { id: true, profile: { select: { displayName: true, username: true, avatarMedia: { select: { url: true } } } } } },
          media: { orderBy: { order: 'asc' }, include: { media: { select: { id: true, url: true, type: true } } } },
        },
      },
      account: { select: { id: true, status: true, userId: true } },
      stats: true,
      donations: {
        take: 20,
        orderBy: { createdAt: 'desc' },
        include: { donor: { select: { id: true, profile: { select: { displayName: true, username: true, avatarMedia: { select: { url: true } } } } } } },
      },
    },
  });

  if (!campaign) {
    const err = new Error('Campaign not found');
    err.statusCode = 404;
    throw err;
  }

  return campaign;
}

async function createCampaign({ userId, title, caption, targetAmount, deadline, mediaIds = [] }) {
  const t = String(title || '').trim();
  if (!t) {
    const err = new Error('title is required');
    err.statusCode = 400;
    throw err;
  }

  const amount = parseIntSafe(targetAmount, 0);
  if (amount <= 0) {
    const err = new Error('targetAmount must be > 0');
    err.statusCode = 400;
    throw err;
  }

  const dl = new Date(deadline);
  if (!(dl instanceof Date) || Number.isNaN(dl.getTime())) {
    const err = new Error('deadline is invalid (ISO string expected)');
    err.statusCode = 400;
    throw err;
  }

  const ids = (Array.isArray(mediaIds) ? mediaIds : [])
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));

  // ensure account exists (Phase A: auto-create pending)
  const account = await prisma.fundraisingAccount.upsert({
    where: { userId: Number(userId) },
    update: { deletedAt: null },
    create: { userId: Number(userId) },
  });

  const created = await prisma.$transaction(async (tx) => {
    const post = await tx.post.create({
      data: {
        authorId: Number(userId),
        type: ids.length > 0 ? 'IMAGE' : 'TEXT',
        category: 'FUNDRAISING',
        caption: typeof caption === 'string' ? caption.trim() : null,
        media: { create: ids.map((mediaId, idx) => ({ mediaId, order: idx })) },
      },
    });

    const campaign = await tx.fundraisingCampaign.create({
      data: {
        postId: post.id,
        accountId: account.id,
        title: t,
        targetAmount: amount,
        deadline: dl,
        stats: { create: {} },
      },
      include: {
        post: true,
        stats: true,
        account: { select: { id: true, status: true, userId: true } },
      },
    });

    return campaign;
  });

  return created;
}

async function updateCampaign({ userId, id, title, caption, targetAmount, deadline, status }) {
  const campaignId = parseIntSafe(id);
  const campaign = await prisma.fundraisingCampaign.findFirst({
    where: { id: campaignId, deletedAt: null },
    include: { post: { select: { id: true, authorId: true } }, account: { select: { userId: true } } },
  });

  if (!campaign) {
    const err = new Error('Campaign not found');
    err.statusCode = 404;
    throw err;
  }

  // owner: either post author or account owner
  if (Number(campaign.post.authorId) !== Number(userId) && Number(campaign.account.userId) !== Number(userId)) {
    const err = new Error('Forbidden');
    err.statusCode = 403;
    throw err;
  }

  const data = {};
  if (title !== undefined) data.title = String(title || '').trim() || campaign.title;
  if (targetAmount !== undefined) {
    const amt = parseIntSafe(targetAmount, campaign.targetAmount);
    if (amt > 0) data.targetAmount = amt;
  }
  if (deadline !== undefined) {
    const dl = new Date(deadline);
    if (!Number.isNaN(dl.getTime())) data.deadline = dl;
  }
  if (status !== undefined) {
    const s = normalizeCampaignStatus(status);
    if (s) data.status = s;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const c = await tx.fundraisingCampaign.update({
      where: { id: campaignId },
      data,
      include: { stats: true, account: { select: { id: true, status: true, userId: true } } },
    });

    if (caption !== undefined) {
      await tx.post.update({
        where: { id: campaign.post.id },
        data: { caption: (caption ?? '').toString().trim() || null },
      });
    }

    return c;
  });

  return updated;
}

async function deleteCampaign({ userId, id }) {
  const campaignId = parseIntSafe(id);
  const campaign = await prisma.fundraisingCampaign.findFirst({
    where: { id: campaignId, deletedAt: null },
    include: { post: { select: { id: true, authorId: true } }, account: { select: { userId: true } } },
  });

  if (!campaign) {
    const err = new Error('Campaign not found');
    err.statusCode = 404;
    throw err;
  }

  if (Number(campaign.post.authorId) !== Number(userId) && Number(campaign.account.userId) !== Number(userId)) {
    const err = new Error('Forbidden');
    err.statusCode = 403;
    throw err;
  }

  await prisma.$transaction(async (tx) => {
    await tx.fundraisingCampaign.update({ where: { id: campaignId }, data: { deletedAt: new Date(), status: 'ENDED' } });
    await tx.post.update({ where: { id: campaign.post.id }, data: { deletedAt: new Date() } });
  });

  return { id: campaignId, deletedAt: true };
}

async function donate({ donorId, campaignId, amount }) {
  const cid = parseIntSafe(campaignId);
  const amt = parseIntSafe(amount, 0);
  if (amt <= 0) {
    const err = new Error('amount must be > 0');
    err.statusCode = 400;
    throw err;
  }

  const campaign = await prisma.fundraisingCampaign.findFirst({
    where: { id: cid, deletedAt: null, status: { in: ['ACTIVE', 'PAUSED'] } },
    include: { stats: true },
  });

  if (!campaign) {
    const err = new Error('Campaign not found');
    err.statusCode = 404;
    throw err;
  }

  const result = await prisma.$transaction(async (tx) => {
    const donation = await tx.donation.create({
      data: {
        campaignId: cid,
        donorId: Number(donorId),
        amount: amt,
        status: 'SUCCESS',
      },
    });

    const stats = await tx.fundraisingCampaignStats.upsert({
      where: { campaignId: cid },
      update: {
        raisedAmount: { increment: amt },
        donorsCount: { increment: 1 },
        lastDonationAt: new Date(),
      },
      create: {
        campaignId: cid,
        raisedAmount: amt,
        donorsCount: 1,
        lastDonationAt: new Date(),
      },
    });

    return { donation, stats };
  });

  return result;
}

module.exports = {
  getFeed,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  donate,
};
