
import { Prisma, PartnerStatus, FundraisingWithdrawRequestStatus, FundraisingAccountStatus } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";

function normalizeCampaignStatus(status) {
  const s = String(status || '').toUpperCase();
  const allowed = ['ACTIVE', 'PAUSED', 'ENDED'];
  return allowed.includes(s) ? s : null;
}

function parseIntSafe(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

async function getFeed({ limit = 50, cursor, verified, sort, category, location }) {
  const take = Math.min(parseIntSafe(limit, 50), 100);
  const where: Prisma.FundraisingCampaignWhereInput = { deletedAt: null };

  if (verified !== undefined) {
    const b = String(verified).toLowerCase();
    if (b === 'true' || b === '1') where.account = { status: 'VERIFIED', deletedAt: null };
    if (b === 'false' || b === '0') where.account = { status: { not: 'VERIFIED' }, deletedAt: null };
  }
  if (category !== undefined) {
    const c = String(category || "").trim();
    if (c) where.category = c;
  }
  if (location !== undefined) {
    const l = String(location || "").trim();
    if (l) where.locationText = { contains: l, mode: "insensitive" };
  }


  let orderBy: Prisma.FundraisingCampaignOrderByWithRelationInput = { createdAt: 'desc' };
  const s = String(sort || '').toUpperCase();
  if (s === 'NEW') orderBy = { createdAt: 'desc' };
  if (s === 'TOP_DONATED') orderBy = { stats: { raisedAmount: 'desc' } };
  if (s === 'ENDING_SOON') orderBy = { deadline: 'asc' };

  const args: Prisma.FundraisingCampaignFindManyArgs = {
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
      donations: {
        take: 3,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          amount: true,
          createdAt: true,
          donor: { select: { id: true, profile: { select: { displayName: true, username: true, avatarMedia: { select: { url: true } } } } } },
        },
      },

    },
  };

  if (cursor) {
    args.skip = 1;
    args.cursor = { id: parseIntSafe(cursor) };
  }

  const list = await prisma.fundraisingCampaign.findMany(args);
  return list;
}

// My campaigns list for the unified withdraw UI.
// Returns only campaigns created by the current user's fundraising account.
// If the user has no fundraising account yet, returns an empty list.
async function listMyCampaigns({ userId, limit = 100 }) {
  const take = Math.min(parseIntSafe(limit, 100), 200);
  const acc = await prisma.fundraisingAccount.findFirst({
    where: { userId: Number(userId), deletedAt: null },
  });
  if (!acc) return [];

  return prisma.fundraisingCampaign.findMany({
    where: { accountId: acc.id, deletedAt: null },
    take,
    orderBy: { createdAt: 'desc' },
    include: {
      stats: true,
      post: {
        include: {
          media: { orderBy: { order: 'asc' }, include: { media: { select: { id: true, url: true, type: true } } } },
        },
      },
      account: { select: { id: true, status: true, userId: true } },
    },
  });
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
        select: {
          id: true,
          amount: true,
          createdAt: true,
          donor: { select: { id: true, profile: { select: { displayName: true, username: true, avatarMedia: { select: { url: true } } } } } },
        },
      },
    },
  });

  if (!campaign) {
    const err = new Error('Campaign not found');
    (err as any).statusCode = 404;
    throw err;
  }

  return campaign;
}

// Aggregated endpoint for donation single page.
// NOTE: Does not replace existing endpoints; it's an optional convenience endpoint.
async function getCampaignSingle({ id }) {
  const campaignId = parseIntSafe(id);

  const campaign = await prisma.fundraisingCampaign.findFirst({
    where: { id: campaignId, deletedAt: null },
    include: {
      post: {
        include: {
          author: {
            select: {
              id: true,
              profile: {
                select: { displayName: true, username: true, avatarMedia: { select: { url: true } } },
              },
            },
          },
          media: { orderBy: { order: 'asc' }, include: { media: { select: { id: true, url: true, type: true } } } },
          _count: { select: { likes: true, comments: true } },
        },
      },
      account: { select: { id: true, status: true, userId: true } },
      stats: true,
      donations: {
        take: 3,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          amount: true,
          createdAt: true,
          donor: { select: { id: true, profile: { select: { displayName: true, username: true, avatarMedia: { select: { url: true } } } } } },
        },
      },
    },
  });

  if (!campaign) {
    const err = new Error('Campaign not found');
    (err as any).statusCode = 404;
    throw err;
  }

  const updates = await prisma.fundraisingUpdate.findMany({
    where: { campaignId: campaignId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: {
      post: {
        include: {
          author: {
            select: {
              id: true,
              profile: {
                select: { displayName: true, username: true, avatarMedia: { select: { url: true } } },
              },
            },
          },
          media: { orderBy: { order: 'asc' }, include: { media: { select: { id: true, url: true, type: true } } } },
        },
      },
    },
  });

  const postCounts = {
    likeCount: campaign.post?._count?.likes ?? 0,
    commentCount: campaign.post?._count?.comments ?? 0,
  };

  // strip prisma internal _count
  if (campaign.post) campaign.post._count = undefined;

  return { campaign, postCounts, updates };
}

async function createCampaign({ userId, title, caption, targetAmount, deadline, category, locationText, mediaIds = [] }) {
  const t = String(title || '').trim();
  if (!t) {
    const err = new Error('title is required');
    (err as any).statusCode = 400;
    throw err;
  }

  const amount = parseIntSafe(targetAmount, 0);
  if (amount <= 0) {
    const err = new Error('targetAmount must be > 0');
    (err as any).statusCode = 400;
    throw err;
  }

  const dl = new Date(deadline);
  if (!(dl instanceof Date) || Number.isNaN(dl.getTime())) {
    const err = new Error('deadline is invalid (ISO string expected)');
    (err as any).statusCode = 400;
    throw err;
  }

  const ids = (Array.isArray(mediaIds) ? mediaIds : [])
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));

  const cat = String(category || "").trim();
  if (!cat) {
    const err = new Error("category is required");
    (err as any).statusCode = 400;
    throw err;
  }

  const loc = String(locationText || "").trim();
  if (!loc) {
    const err = new Error("locationText is required");
    (err as any).statusCode = 400;
    throw err;
  }

  const account = await prisma.fundraisingAccount.findFirst({
    where: { userId: Number(userId), deletedAt: null },
  });
  if (!account) {
    const err = new Error("Fundraising account required");
    (err as any).statusCode = 403;
    throw err;
  }
  // Allow creating campaigns even if verification is pending,
  // but require user to submit verification info + documents.
  const missing = [];
  if (!account.presentAddress) missing.push('presentAddress');
  if (!account.permanentAddress) missing.push('permanentAddress');
  if (!account.divisionId || !account.districtId || !account.areaId) missing.push('location'); // upazilaId optional for City Corporation areas
  if (!account.dateOfBirth) missing.push('dateOfBirth');

  const docsCount = await prisma.fundraisingVerificationDocument.count({
    where: { accountId: account.id, deletedAt: null },
  });
  if (docsCount < 1) missing.push('documents');

  if (missing.length > 0) {
    const err = new Error('Please complete verification form and upload documents before creating a fundraising post.');
    (err as any).statusCode = 403;
    (err as any).details = { missing };
    throw err;
  }


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
        category: cat,
        locationText: loc,

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

async function updateCampaign({ userId, id, title, caption, targetAmount, deadline, category, locationText, status, mediaIds }) {
  const campaignId = parseIntSafe(id);
  const campaign = await prisma.fundraisingCampaign.findFirst({
    where: { id: campaignId, deletedAt: null },
    include: { post: { select: { id: true, authorId: true } }, account: { select: { userId: true } } },
  });

  if (!campaign) {
    const err = new Error('Campaign not found');
    (err as any).statusCode = 404;
    throw err;
  }

  // owner: either post author or account owner
  if (Number(campaign.post.authorId) !== Number(userId) && Number(campaign.account.userId) !== Number(userId)) {
    const err = new Error('Forbidden');
    (err as any).statusCode = 403;
    throw err;
  }

  const data: any = {};
  if (title !== undefined) data.title = String(title || '').trim() || campaign.title;
  if (category !== undefined) data.category = String(category || '').trim() || null;
  if (locationText !== undefined) data.locationText = String(locationText || '').trim() || null;
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

    if (mediaIds !== undefined) {
      const ids = (Array.isArray(mediaIds) ? mediaIds : [])
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x));

      // replace media ordering
      await tx.postMedia.deleteMany({ where: { postId: campaign.post.id } });
      if (ids.length > 0) {
        await tx.postMedia.createMany({
          data: ids.map((mediaId, idx) => ({ postId: campaign.post.id, mediaId, order: idx })),
        });
      }

      await tx.post.update({
        where: { id: campaign.post.id },
        data: { type: ids.length > 0 ? 'IMAGE' : 'TEXT' },
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
    (err as any).statusCode = 404;
    throw err;
  }

  if (Number(campaign.post.authorId) !== Number(userId) && Number(campaign.account.userId) !== Number(userId)) {
    const err = new Error('Forbidden');
    (err as any).statusCode = 403;
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
    (err as any).statusCode = 400;
    throw err;
  }

  const campaign = await prisma.fundraisingCampaign.findFirst({
    where: { id: cid, deletedAt: null, status: { in: ['ACTIVE', 'PAUSED'] } },
    include: { stats: true, account: { select: { userId: true } } },
  });

  if (!campaign) {
    const err = new Error('Campaign not found');
    (err as any).statusCode = 404;
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

    // ------------------------------
    // V1: Donation -> Campaign Owner Wallet Credit (ledger)
    // ------------------------------
    const ownerUserId = Number(campaign.account?.userId);
    if (ownerUserId && ownerUserId > 0) {
      // Ensure wallet exists + treat legacy `balance` as available if splits were not used before.
      const ownerWallet = await tx.userWallet.upsert({
        where: { userId: ownerUserId },
        update: {},
        create: {
          userId: ownerUserId,
          balance: 0,
          availableBalance: 0,
          pendingBalance: 0,
          lockedBalance: 0,
        },
      });

      const splitSum = Number(ownerWallet.availableBalance) + Number(ownerWallet.pendingBalance) + Number(ownerWallet.lockedBalance);
      if (splitSum === 0 && Number(ownerWallet.balance) > 0) {
        await tx.userWallet.update({
          where: { id: ownerWallet.id },
          data: { availableBalance: ownerWallet.balance },
        });
      }

      await tx.userWallet.update({
        where: { id: ownerWallet.id },
        data: {
          balance: { increment: amt },
          availableBalance: { increment: amt },
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: ownerWallet.id,
          type: 'CREDIT',
          status: 'SUCCESS',
          amount: amt,
          method: null,
          reference: null,
          sourceType: 'DONATION',
          sourceId: donation.id,
          note: `Donation credit for campaign ${cid}`,
        },
      });
    }

    // Donation reward: convert amount to points (configurable)
    const pointsPer100 = Number(process.env.DONATION_POINTS_PER_100 || 1);
    const points = Math.floor(amt / 100) * (Number.isFinite(pointsPer100) ? pointsPer100 : 1);
    let wallet = null;
    if (points > 0) {
      wallet = await tx.userWallet.upsert({
        where: { userId: Number(donorId) },
        update: { points: { increment: points } },
        create: { userId: Number(donorId), points },
      });

      await tx.rewardHistory.create({
        data: {
          userId: Number(donorId),
          action: "DONATION",
          points,
          description: `Donation reward points (${amt} BDT)`,
          referenceId: String(donation.id),
        },
      });

      await tx.userStatsCache.upsert({
        where: { userId: Number(donorId) },
        update: { pawPoints: { increment: points } },
        create: { userId: Number(donorId), pawPoints: points },
      });
    }

    return { donation, stats };
  });

  return result;
}

// ------------------------------
// Donations list (pagination)
// ------------------------------
async function listDonations({ campaignId, limit = 50, cursor }) {
  const cid = parseIntSafe(campaignId);
  const take = Math.min(parseIntSafe(limit, 50), 100);

  const args: Prisma.DonationFindManyArgs = {
    where: { campaignId: cid },
    take,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      amount: true,
      status: true,
      createdAt: true,
      donor: { select: { id: true, profile: { select: { displayName: true, username: true, avatarMedia: { select: { url: true } } } } } },
    },
  };

  if (cursor) {
    args.skip = 1;
    args.cursor = { id: parseIntSafe(cursor) };
  }

  const list = await prisma.donation.findMany(args);
  return list;
}

// ------------------------------
// FUNDRAISING PAYOUT (Phase C)
// ------------------------------

async function listPayoutCatalog({ activeOnly = true } = {}) {
  return prisma.fundraisingPayoutMethodCatalog.findMany({
    where: activeOnly ? { isActive: true } : {},
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  });
}

async function getMyFundraisingAccountOrThrow({ userId }) {
  const acc = await prisma.fundraisingAccount.findFirst({
    where: { userId: Number(userId), deletedAt: null },
  });
  if (!acc) {
    const err = new Error('Fundraising account not found');
    (err as any).statusCode = 404;
    throw err;
  }
  return acc;
}

async function listMyPayoutMethods({ userId }) {
  const acc = await getMyFundraisingAccountOrThrow({ userId });
  return prisma.fundraisingPayoutMethod.findMany({
    where: { accountId: acc.id, deletedAt: null },
    include: { catalog: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
}

async function createMyPayoutMethod({ userId, catalogId, label, detailsJson, isDefault }) {
  const acc = await getMyFundraisingAccountOrThrow({ userId });
  const details = String(detailsJson || '').trim();
  if (!details) {
    const err = new Error('detailsJson is required');
    (err as any).statusCode = 400;
    throw err;
  }

  const cat = await prisma.fundraisingPayoutMethodCatalog.findFirst({
    where: { id: parseIntSafe(catalogId), isActive: true },
  });
  if (!cat) {
    const err = new Error('Payout method not found');
    (err as any).statusCode = 404;
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    if (isDefault === true) {
      await tx.fundraisingPayoutMethod.updateMany({
        where: { accountId: acc.id, deletedAt: null },
        data: { isDefault: false },
      });
    }
    const created = await tx.fundraisingPayoutMethod.create({
      data: {
        accountId: acc.id,
        catalogId: cat.id,
        label: label ? String(label) : null,
        detailsJson: details,
        isDefault: isDefault === true,
      },
      include: { catalog: true },
    });
    // If first method, set default automatically
    if (!created.isDefault) {
      const count = await tx.fundraisingPayoutMethod.count({ where: { accountId: acc.id, deletedAt: null } });
      if (count === 1) {
        await tx.fundraisingPayoutMethod.update({ where: { id: created.id }, data: { isDefault: true } });
        return { ...created, isDefault: true };
      }
    }
    return created;
  });
}

async function updateMyPayoutMethod({ userId, id, label, detailsJson, isDefault, isActive }) {
  const acc = await getMyFundraisingAccountOrThrow({ userId });
  const mid = parseIntSafe(id);
  const found = await prisma.fundraisingPayoutMethod.findFirst({
    where: { id: mid, accountId: acc.id, deletedAt: null },
  });
  if (!found) {
    const err = new Error('Payout method not found');
    (err as any).statusCode = 404;
    throw err;
  }

  const data: any = {};
  if (label !== undefined) data.label = label ? String(label) : null;
  if (detailsJson !== undefined) {
    const details = String(detailsJson || '').trim();
    if (!details) {
      const err = new Error('detailsJson cannot be empty');
      (err as any).statusCode = 400;
      throw err;
    }
    data.detailsJson = details;
  }
  if (isActive !== undefined) data.isActive = !!isActive;

  return prisma.$transaction(async (tx) => {
    if (isDefault === true) {
      await tx.fundraisingPayoutMethod.updateMany({
        where: { accountId: acc.id, deletedAt: null },
        data: { isDefault: false },
      });
      data.isDefault = true;
    }
    const updated = await tx.fundraisingPayoutMethod.update({
      where: { id: mid },
      data,
      include: { catalog: true },
    });
    return updated;
  });
}

async function deleteMyPayoutMethod({ userId, id }) {
  const acc = await getMyFundraisingAccountOrThrow({ userId });
  const mid = parseIntSafe(id);
  const found = await prisma.fundraisingPayoutMethod.findFirst({
    where: { id: mid, accountId: acc.id, deletedAt: null },
  });
  if (!found) {
    const err = new Error('Payout method not found');
    (err as any).statusCode = 404;
    throw err;
  }
  // Prevent delete if referenced by non-finalized withdraw requests
  const refCount = await prisma.fundraisingWithdrawRequest.count({
    where: { methodId: mid, deletedAt: null, status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'] } },
  });
  if (refCount > 0) {
    const err = new Error('Cannot delete: payout method is in use by pending withdraw requests');
    (err as any).statusCode = 409;
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    await tx.fundraisingPayoutMethod.update({ where: { id: mid }, data: { deletedAt: new Date(), isActive: false, isDefault: false } });
    // If it was default, pick another
    const next = await tx.fundraisingPayoutMethod.findFirst({
      where: { accountId: acc.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (next) {
      await tx.fundraisingPayoutMethod.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    return { ok: true };
  });
}

async function createWithdrawRequest({ userId, campaignId, amount, methodId, note, idempotencyKey }) {
  const acc = await getMyFundraisingAccountOrThrow({ userId });
  if (acc.status !== 'VERIFIED') {
    const err = new Error('Fundraising account must be verified to withdraw');
    (err as any).statusCode = 403;
    throw err;
  }

  const cid = parseIntSafe(campaignId);
  const amt = parseIntSafe(amount, 0);
  if (amt <= 0) {
    const err = new Error('amount must be > 0');
    (err as any).statusCode = 400;
    throw err;
  }

  const mid = parseIntSafe(methodId);

  // Idempotency (client retry protection): if the client retries the same request,
  // return the already-created withdraw request.
  const idemKey = idempotencyKey ? String(idempotencyKey).trim() : null;
  if (idemKey) {
    const existingHold = await prisma.walletTransaction.findFirst({
      where: {
        reference: `idem-fund:${idemKey}`,
        sourceType: 'FUNDRAISING_WITHDRAW_REQUEST',
      },
      orderBy: { id: 'desc' },
    });
    if (existingHold?.sourceId) {
      const existingReq = await prisma.fundraisingWithdrawRequest.findUnique({
        where: { id: existingHold.sourceId },
        include: { method: { include: { catalog: true } } },
      });
      if (existingReq) return existingReq;
    }
  }

  // IMPORTANT:
  // Prevent multiple withdraw requests that "double-spend" the same collected funds.
  // We enforce this in the backend (not just UI).
  // Rule:
  //   - Only ONE open request per campaign at a time (SUBMITTED/UNDER_REVIEW/APPROVED)
  //   - Amount cannot exceed: raisedAmount - withdrawnAmount - sum(openRequests.amount)
  // We do this inside a transaction to avoid race conditions.
  return prisma.$transaction(async (tx) => {
    const campaign = await tx.fundraisingCampaign.findFirst({
      where: { id: cid, accountId: acc.id, deletedAt: null },
      include: { stats: true },
    });
    if (!campaign) {
      const err = new Error('Campaign not found');
      (err as any).statusCode = 404;
      throw err;
    }

    const method = await tx.fundraisingPayoutMethod.findFirst({
      where: { id: mid, accountId: acc.id, deletedAt: null, isActive: true },
      include: { catalog: true },
    });
    if (!method || !method.catalog?.isActive) {
      const err = new Error('Payout method not found or inactive');
      (err as any).statusCode = 404;
      throw err;
    }

    // One-open-request rule
    const openStatuses: FundraisingWithdrawRequestStatus[] = ['SUBMITTED','UNDER_REVIEW','APPROVED'];
    const openCount = await tx.fundraisingWithdrawRequest.count({
      where: {
        campaignId: cid,
        deletedAt: null,
        status: { in: openStatuses },
      },
    });
    if (openCount > 0) {
      const err = new Error('A withdraw request is already pending for this campaign. Please wait for admin review.');
      (err as any).statusCode = 409;
      throw err;
    }

    // Available balance check (subtract any open requests in case you later allow multiple)
    const pendingAgg = await tx.fundraisingWithdrawRequest.aggregate({
      where: {
        campaignId: cid,
        deletedAt: null,
        status: { in: openStatuses },
      },
      _sum: { amount: true },
    });
    const reserved = pendingAgg?._sum?.amount || 0;

    const stats = campaign.stats || { raisedAmount: 0, withdrawnAmount: 0 };
    const raised = stats.raisedAmount || 0;
    const withdrawn = stats.withdrawnAmount || 0;
    const available = raised - withdrawn - reserved;
    if (amt > available) {
      const err = new Error(`Insufficient available balance. Available: ${available}`);
      (err as any).statusCode = 400;
      throw err;
    }

    const req = await tx.fundraisingWithdrawRequest.create({
      data: {
        campaignId: cid,
        accountId: acc.id,
        methodId: mid,
        amount: amt,
        status: 'SUBMITTED',
        note: note ? String(note) : null,
      },
      include: { method: { include: { catalog: true } } },
    });

    // ------------------------------
    // V1: Reserve funds from fundraiser wallet (available -> pending)
    // ------------------------------
    const ownerUserId = Number(acc.userId);
    if (ownerUserId && ownerUserId > 0) {
      const w = await tx.userWallet.upsert({
        where: { userId: ownerUserId },
        update: {},
        create: {
          userId: ownerUserId,
          balance: 0,
          availableBalance: 0,
          pendingBalance: 0,
          lockedBalance: 0,
        },
      });

      const splitSum = Number(w.availableBalance) + Number(w.pendingBalance) + Number(w.lockedBalance);
      if (splitSum === 0 && Number(w.balance) > 0) {
        await tx.userWallet.update({ where: { id: w.id }, data: { availableBalance: w.balance } });
      }

      // Ensure wallet has enough available (extra safety; campaign-level check already done)
      // Lock wallet row to prevent concurrent withdraw requests from overspending available balance
      await tx.$queryRaw`SELECT id FROM "user_wallets" WHERE id = ${w.id} FOR UPDATE`;
      const fresh = await tx.userWallet.findUnique({ where: { id: w.id } });
      if (Number(fresh.availableBalance) < amt) {
        const err = new Error('Insufficient wallet available balance for withdraw reservation');
        (err as any).statusCode = 409;
        throw err;
      }

      // Reserve (HOLD): available -> locked
      // We only move to pending when admin approves / payout starts.
      await tx.userWallet.update({
        where: { id: w.id },
        data: {
          availableBalance: { decrement: amt },
          lockedBalance: { increment: amt },
          // Keep `balance` as total (no change here, because we only moved buckets)
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: w.id,
          type: 'DEBIT',
          status: 'PENDING',
          amount: amt,
          method: null,
          reference: idemKey ? `idem-fund:${idemKey}` : null,
          sourceType: 'FUNDRAISING_WITHDRAW_REQUEST',
          sourceId: req.id,
          note: `Fundraising withdraw request (reserved) for campaign ${cid}`,
        },
      });
    }

    return req;
  });
}

async function listMyWithdrawRequests({ userId, campaignId, limit = 50, cursor }) {
  const acc = await getMyFundraisingAccountOrThrow({ userId });
  const take = Math.min(parseIntSafe(limit, 50), 100);
  const where: Prisma.FundraisingWithdrawRequestWhereInput = { accountId: acc.id, deletedAt: null };
  if (campaignId) (where as any).campaignId = parseIntSafe(campaignId);
  const args: Prisma.FundraisingWithdrawRequestFindManyArgs = {
    where,
    take,
    orderBy: { createdAt: 'desc' },
    include: {
      campaign: { select: { id: true, title: true } },
      method: { include: { catalog: true } },
      transferLog: true,
    },
  };
  if (cursor) {
    args.skip = 1;
    args.cursor = { id: parseIntSafe(cursor) };
  }
  return prisma.fundraisingWithdrawRequest.findMany(args);
}

async function adminListWithdrawRequests({ status, limit = 50, cursor }) {
  const take = Math.min(parseIntSafe(limit, 50), 100);
  const where: Prisma.FundraisingWithdrawRequestWhereInput = { deletedAt: null };
  if (status) (where as any).status = String(status).toUpperCase() as FundraisingAccountStatus;
  const args: Prisma.FundraisingWithdrawRequestFindManyArgs = {
    where,
    take,
    orderBy: { createdAt: 'desc' },
    include: {
      account: { include: { user: { select: { id: true, profile: { select: { displayName: true, username: true } } } } } },
      campaign: { select: { id: true, title: true } },
      method: { include: { catalog: true } },
      adminUser: { select: { id: true, profile: { select: { displayName: true, username: true } } } },
      transferLog: true,
    },
  };
  if (cursor) {
    args.skip = 1;
    args.cursor = { id: parseIntSafe(cursor) };
  }
  return prisma.fundraisingWithdrawRequest.findMany(args);
}

async function adminUpdateWithdrawRequestStatus({ adminUserId, id, status, note, reference, proofMediaId }) {
  const rid = parseIntSafe(id);
  const next = String(status || '').toUpperCase();
  const allowed = ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'TRANSFERRED'];
  if (!allowed.includes(next)) {
    const err = new Error(`Invalid status. Allowed: ${allowed.join(', ')}`);
    (err as any).statusCode = 400;
    throw err;
  }

  const req = await prisma.fundraisingWithdrawRequest.findFirst({
    where: { id: rid, deletedAt: null },
    include: { campaign: { include: { stats: true, account: { select: { userId: true } } } }, method: true },
  });
  if (!req) {
    const err = new Error('Withdraw request not found');
    (err as any).statusCode = 404;
    throw err;
  }

  if (next === 'TRANSFERRED' && req.status !== 'APPROVED') {
    const err = new Error('Request must be APPROVED before marking as TRANSFERRED');
    (err as any).statusCode = 409;
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.fundraisingWithdrawRequest.update({
      where: { id: rid },
      data: {
        status: next as FundraisingWithdrawRequestStatus,
        note: note !== undefined ? (note ? String(note) : null) : req.note,
        adminUserId: adminUserId ? Number(adminUserId) : null,
        reviewedAt: next === 'UNDER_REVIEW' || next === 'APPROVED' || next === 'REJECTED' ? new Date() : req.reviewedAt,
        processedAt: next === 'TRANSFERRED' ? new Date() : req.processedAt,
      },
    });

    // Wallet bucket flow:
    // - On request create: available -> locked (reserve)
    // - On APPROVED: locked -> pending
    // - On TRANSFERRED: pending -> paid out (balance decreases)
    // - On REJECTED: release back to available (from pending if already approved, else from locked)

    if (next === 'APPROVED' && req.status !== 'APPROVED') {
      const ownerUserId = Number(req.campaign?.account?.userId);
      if (ownerUserId && ownerUserId > 0) {
        const w = await tx.userWallet.upsert({
          where: { userId: ownerUserId },
          update: {},
          create: { userId: ownerUserId, balance: 0, availableBalance: 0, pendingBalance: 0, lockedBalance: 0 },
        });

        await tx.userWallet.update({
          where: { id: w.id },
          data: {
            lockedBalance: { decrement: req.amount },
            pendingBalance: { increment: req.amount },
          },
        });

        await tx.walletTransaction.updateMany({
          where: { walletId: w.id, sourceType: 'FUNDRAISING_WITHDRAW_REQUEST', sourceId: rid, type: 'DEBIT' },
          data: { note: 'Approved (moved to pending)' },
        });
      }
    }

    if (next === 'TRANSFERRED') {
      // Update stats withdrawnAmount
      await tx.fundraisingCampaignStats.upsert({
        where: { campaignId: req.campaignId },
        update: { withdrawnAmount: { increment: req.amount }, lastPayoutAt: new Date() },
        create: { campaignId: req.campaignId, withdrawnAmount: req.amount, raisedAmount: 0, donorsCount: 0, lastPayoutAt: new Date() },
      });
      // Create or update transfer log
      await tx.fundraisingPayoutTransferLog.upsert({
        where: { requestId: rid },
        update: {
          reference: reference ? String(reference) : undefined,
          proofMediaId: proofMediaId ? Number(proofMediaId) : undefined,
          methodSnapshotJson: JSON.stringify({ methodId: req.methodId, detailsJson: req.method.detailsJson }),
        },
        create: {
          requestId: rid,
          reference: reference ? String(reference) : null,
          proofMediaId: proofMediaId ? Number(proofMediaId) : null,
          methodSnapshotJson: JSON.stringify({ methodId: req.methodId, detailsJson: req.method.detailsJson }),
        },
      });

      // ------------------------------
      // V1: Finalize wallet buckets + ledger
      // pendingBalance -> (paid out) and total balance decreases
      // ------------------------------
      const ownerUserId = Number(req.campaign?.account?.userId);
      if (ownerUserId && ownerUserId > 0) {
        const w = await tx.userWallet.upsert({
          where: { userId: ownerUserId },
          update: {},
          create: {
            userId: ownerUserId,
            balance: 0,
            availableBalance: 0,
            pendingBalance: 0,
            lockedBalance: 0,
          },
        });

        await tx.userWallet.update({
          where: { id: w.id },
          data: {
            pendingBalance: { decrement: req.amount },
            balance: { decrement: req.amount },
          },
        });

        // Mark the existing reservation ledger entry as SUCCESS and attach reference (if provided)
        await tx.walletTransaction.updateMany({
          where: {
            walletId: w.id,
            sourceType: 'FUNDRAISING_WITHDRAW_REQUEST',
            sourceId: rid,
            type: 'DEBIT',
          },
          data: {
            status: 'SUCCESS',
            reference: reference ? String(reference) : undefined,
            note: note ? String(note) : undefined,
          },
        });
      }
    }

    if (next === 'REJECTED') {
      // Release reserved wallet funds back to available
      const ownerUserId = Number(req.campaign?.account?.userId);
      if (ownerUserId && ownerUserId > 0) {
        const w = await tx.userWallet.upsert({
          where: { userId: ownerUserId },
          update: {},
          create: {
            userId: ownerUserId,
            balance: 0,
            availableBalance: 0,
            pendingBalance: 0,
            lockedBalance: 0,
          },
        });

        const fromPending = req.status === 'APPROVED' || req.status === 'TRANSFERRED';
        await tx.userWallet.update({
          where: { id: w.id },
          data: fromPending
            ? { pendingBalance: { decrement: req.amount }, availableBalance: { increment: req.amount } }
            : { lockedBalance: { decrement: req.amount }, availableBalance: { increment: req.amount } },
        });

        await tx.walletTransaction.updateMany({
          where: {
            walletId: w.id,
            sourceType: 'FUNDRAISING_WITHDRAW_REQUEST',
            sourceId: rid,
            type: 'DEBIT',
          },
          data: {
            status: 'FAILED',
            note: note ? String(note) : 'Withdraw request rejected',
          },
        });
      }
    }

    return updated;
  });
}

// ------------------------------
// Fundraising Updates (Phase B)
// We store each update as a Post(category=FUNDRAISING_UPDATE) and link it.
// ------------------------------
async function listUpdates({ campaignId, limit = 50, cursor }) {
  const cid = parseIntSafe(campaignId);
  const take = Math.min(parseIntSafe(limit, 50), 100);

  const args: Prisma.FundraisingUpdateFindManyArgs = {
    where: { campaignId: cid, deletedAt: null },
    take,
    orderBy: { createdAt: 'desc' },
    include: {
      post: {
        include: {
          author: { select: { id: true, profile: { select: { displayName: true, username: true, avatarMedia: { select: { url: true } } } } } },
          media: { orderBy: { order: 'asc' }, include: { media: { select: { id: true, url: true, type: true } } } },
        },
      },
    },
  };

  if (cursor) {
    args.skip = 1;
    args.cursor = { id: parseIntSafe(cursor) };
  }

  return prisma.fundraisingUpdate.findMany(args);
}

async function createUpdate({ userId, campaignId, caption, mediaIds = [] }) {
  const cid = parseIntSafe(campaignId);
  const ids = (Array.isArray(mediaIds) ? mediaIds : [])
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));

  const campaign = await prisma.fundraisingCampaign.findFirst({
    where: { id: cid, deletedAt: null },
    include: { post: { select: { id: true, authorId: true } }, account: { select: { userId: true } } },
  });
  if (!campaign) {
    const err = new Error('Campaign not found');
    (err as any).statusCode = 404;
    throw err;
  }

  if (Number(campaign.post.authorId) !== Number(userId) && Number(campaign.account.userId) !== Number(userId)) {
    const err = new Error('Forbidden');
    (err as any).statusCode = 403;
    throw err;
  }

  const created = await prisma.$transaction(async (tx) => {
    const post = await tx.post.create({
      data: {
        authorId: Number(userId),
        type: ids.length > 0 ? 'IMAGE' : 'TEXT',
        category: 'FUNDRAISING_UPDATE',
        caption: typeof caption === 'string' ? caption.trim() : null,
        media: { create: ids.map((mediaId, idx) => ({ mediaId, order: idx })) },
      },
    });

    const update = await tx.fundraisingUpdate.create({
      data: { campaignId: cid, postId: post.id },
      include: {
        post: {
          include: {
            author: { select: { id: true, profile: { select: { displayName: true, username: true, avatarMedia: { select: { url: true } } } } } },
            media: { orderBy: { order: 'asc' }, include: { media: { select: { id: true, url: true, type: true } } } },
          },
        },
      },
    });

    return update;
  });

  return created;
}

async function updateUpdate({ userId, updateId, caption, mediaIds }) {
  const uid = parseIntSafe(updateId);
  const update = await prisma.fundraisingUpdate.findFirst({
    where: { id: uid, deletedAt: null },
    include: { campaign: { include: { post: { select: { authorId: true } }, account: { select: { userId: true } } } }, post: { select: { id: true } } },
  });
  if (!update) {
    const err = new Error('Update not found');
    (err as any).statusCode = 404;
    throw err;
  }

  if (Number(update.campaign.post.authorId) !== Number(userId) && Number(update.campaign.account.userId) !== Number(userId)) {
    const err = new Error('Forbidden');
    (err as any).statusCode = 403;
    throw err;
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (caption !== undefined) {
      await tx.post.update({
        where: { id: update.post.id },
        data: { caption: (caption ?? '').toString().trim() || null },
      });
    }

    if (mediaIds !== undefined) {
      const ids = (Array.isArray(mediaIds) ? mediaIds : [])
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x));

      await tx.postMedia.deleteMany({ where: { postId: update.post.id } });
      if (ids.length > 0) {
        await tx.postMedia.createMany({
          data: ids.map((mediaId, idx) => ({ postId: update.post.id, mediaId, order: idx })),
        });
      }

      await tx.post.update({
        where: { id: update.post.id },
        data: { type: ids.length > 0 ? 'IMAGE' : 'TEXT' },
      });
    }

    // bump update timestamps
    return tx.fundraisingUpdate.update({
      where: { id: uid },
      data: {},
      include: {
        post: {
          include: {
            author: { select: { id: true, profile: { select: { displayName: true, username: true, avatarMedia: { select: { url: true } } } } } },
            media: { orderBy: { order: 'asc' }, include: { media: { select: { id: true, url: true, type: true } } } },
          },
        },
      },
    });
  });

  return updated;
}

async function deleteUpdate({ userId, updateId }) {
  const uid = parseIntSafe(updateId);
  const update = await prisma.fundraisingUpdate.findFirst({
    where: { id: uid, deletedAt: null },
    include: { campaign: { include: { post: { select: { authorId: true } }, account: { select: { userId: true } } } }, post: { select: { id: true } } },
  });
  if (!update) {
    const err = new Error('Update not found');
    (err as any).statusCode = 404;
    throw err;
  }

  if (Number(update.campaign.post.authorId) !== Number(userId) && Number(update.campaign.account.userId) !== Number(userId)) {
    const err = new Error('Forbidden');
    (err as any).statusCode = 403;
    throw err;
  }

  await prisma.$transaction(async (tx) => {
    await tx.fundraisingUpdate.update({ where: { id: uid }, data: { deletedAt: new Date() } });
    await tx.post.update({ where: { id: update.post.id }, data: { deletedAt: new Date() } });
  });

  return { id: uid, deletedAt: true };
}

// ------------------------------
// Fundraising Account Verification (Phase A)
// ------------------------------
async function getMyAccount({ userId }) {
  const account = await prisma.fundraisingAccount.findFirst({
    where: { userId: Number(userId), deletedAt: null },
    include: {
      documents: { where: { deletedAt: null }, include: { media: { select: { id: true, url: true, type: true } } }, orderBy: { id: 'desc' } },
      campaigns: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 10, include: { stats: true } },
    },
  });
  return account;
}

async function updateMyAccount({ userId, accountType, permanentAddress, presentAddress, occupation, area, rescueSinceYear, orgName, orgDescription, orgWorkType, divisionId, districtId, upazilaId, areaId, dateOfBirth, nationalIdNumber, birthRegNumber, studentIdNumber }) {
  const allowed = ["INDIVIDUAL", "ORGANIZATION"];
  const type = accountType !== undefined ? String(accountType).toUpperCase() : undefined;
  if (type !== undefined && !allowed.includes(type)) {
    const err = new Error("Invalid accountType");
    (err as any).statusCode = 400;
    throw err;
  }

  const data: any = {};
  if (type !== undefined) data.accountType = type;
  if (permanentAddress !== undefined) data.permanentAddress = permanentAddress ? String(permanentAddress) : null;
  if (presentAddress !== undefined) data.presentAddress = presentAddress ? String(presentAddress) : null;
  if (occupation !== undefined) data.occupation = occupation ? String(occupation) : null;
  if (divisionId !== undefined) data.divisionId = divisionId === null ? null : Number(divisionId);
  if (districtId !== undefined) data.districtId = districtId === null ? null : Number(districtId);
  if (upazilaId !== undefined) data.upazilaId = upazilaId === null ? null : Number(upazilaId);
  if (areaId !== undefined) data.areaId = areaId === null ? null : Number(areaId);
  if (dateOfBirth !== undefined) {
    const d = dateOfBirth ? new Date(dateOfBirth) : null;
    data.dateOfBirth = (d && !isNaN(d.getTime())) ? d : null;
  }
  if (nationalIdNumber !== undefined) data.nationalIdNumber = nationalIdNumber ? String(nationalIdNumber) : null;
  if (birthRegNumber !== undefined) data.birthRegNumber = birthRegNumber ? String(birthRegNumber) : null;
  if (studentIdNumber !== undefined) data.studentIdNumber = studentIdNumber ? String(studentIdNumber) : null;
  if (area !== undefined) data.area = area ? String(area) : null;
  if (rescueSinceYear !== undefined) {
    const y = Number(rescueSinceYear);
    data.rescueSinceYear = Number.isFinite(y) ? Math.trunc(y) : null;
  }
  if (orgName !== undefined) data.orgName = orgName ? String(orgName) : null;
  if (orgDescription !== undefined) data.orgDescription = orgDescription ? String(orgDescription) : null;
  if (orgWorkType !== undefined) data.orgWorkType = orgWorkType ? String(orgWorkType) : null;

  const account = await prisma.fundraisingAccount.upsert({
    where: { userId: Number(userId) },
    update: { deletedAt: null, ...data },
    create: { userId: Number(userId), ...data },
  });
  return account;
}


async function addVerificationDocument({ userId, title, mediaId }) {
  const t = String(title || '').trim();
  const mid = Number(mediaId);
  if (!t || !Number.isFinite(mid)) {
    const err = new Error('title and mediaId are required');
    (err as any).statusCode = 400;
    throw err;
  }

  // ensure account exists
  const account = await prisma.fundraisingAccount.upsert({
    where: { userId: Number(userId) },
    update: { deletedAt: null },
    create: { userId: Number(userId) },
  });

  const doc = await prisma.fundraisingVerificationDocument.create({
    data: { accountId: account.id, title: t, mediaId: mid },
    include: { media: { select: { id: true, url: true, type: true } } },
  });
  return doc;
}

async function deleteVerificationDocument({ userId, id }) {
  const docId = parseIntSafe(id);
  const doc = await prisma.fundraisingVerificationDocument.findFirst({
    where: { id: docId, deletedAt: null },
    include: { account: { select: { userId: true } } },
  });
  if (!doc) {
    const err = new Error('Document not found');
    (err as any).statusCode = 404;
    throw err;
  }
  if (Number(doc.account.userId) !== Number(userId)) {
    const err = new Error('Forbidden');
    (err as any).statusCode = 403;
    throw err;
  }

  await prisma.fundraisingVerificationDocument.update({
    where: { id: docId },
    data: { deletedAt: new Date() },
  });

  return { id: docId, deletedAt: true };
}

async function submitAccount({ userId }) {
  const account = await prisma.fundraisingAccount.upsert({
    where: { userId: Number(userId) },
    update: { deletedAt: null },
    create: { userId: Number(userId) },
  });

  const docsCount = await prisma.fundraisingVerificationDocument.count({
    where: { accountId: account.id, deletedAt: null },
  });
  if (docsCount < 1) {
    const err = new Error("At least one verification document is required");
    (err as any).statusCode = 400;
    throw err;
  }

  if (!account.accountType || !account.presentAddress || !account.occupation || !account.area) {
    const err = new Error("Please complete required profile fields before submitting");
    (err as any).statusCode = 400;
    throw err;
  }

  if (account.accountType === "ORGANIZATION") {
    if (!account.orgName || !account.orgDescription || !account.orgWorkType) {
      const err = new Error("Organization fields are required for organization accounts");
      (err as any).statusCode = 400;
      throw err;
    }
  }


  // If already verified keep verified
  if (account.status === 'VERIFIED') return account;

  const updated = await prisma.$transaction(async (tx) => {
    const acc = await tx.fundraisingAccount.update({
      where: { id: account.id },
      data: { status: 'PENDING', submittedAt: new Date() },
    });

    // log
    await tx.fundraisingAccountStatusLog.create({
      data: {
        accountId: account.id,
        fromStatus: account.status,
        toStatus: 'PENDING',
        adminUserId: null,
        note: 'User submitted verification',
      },
    });

    return acc;
  });

  return updated;
}

async function adminListAccounts({ status }) {
  const where: Prisma.FundraisingAccountWhereInput = { deletedAt: null };
  if (status) (where as any).status = String(status).toUpperCase() as FundraisingAccountStatus;

  const list = await prisma.fundraisingAccount.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    include: {
      user: { select: { id: true, profile: { select: { displayName: true, username: true } } } },
      documents: { where: { deletedAt: null }, include: { media: { select: { id: true, url: true, type: true } } }, orderBy: { id: 'desc' } },
      campaigns: { where: { deletedAt: null }, take: 3, orderBy: { createdAt: 'desc' } },
      statusLogs: { orderBy: { id: 'desc' }, take: 10 },
    },
  });

  return list;
}

async function adminUpdateAccountStatus({ adminUserId, accountId, status, note }) {
  const id = parseIntSafe(accountId);
  const s = String(status || '').toUpperCase();
  const allowed = ['PENDING', 'VERIFIED', 'REJECTED'];
  if (!allowed.includes(s)) {
    const err = new Error('Invalid status');
    (err as any).statusCode = 400;
    throw err;
  }

  const account = await prisma.fundraisingAccount.findUnique({ where: { id } });
  if (!account || account.deletedAt) {
    const err = new Error('Account not found');
    (err as any).statusCode = 404;
    throw err;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const acc = await tx.fundraisingAccount.update({ where: { id }, data: { status: s as FundraisingAccountStatus } });
    await tx.fundraisingAccountStatusLog.create({
      data: {
        accountId: id,
        fromStatus: account.status,
        toStatus: s as FundraisingAccountStatus,
        adminUserId: adminUserId ? Number(adminUserId) : null,
        note: note ? String(note) : null,
      },
    });
    return acc;
  });

  return updated;
}

module.exports = {
  getFeed,
  listMyCampaigns,
  getCampaign,
  getCampaignSingle,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  donate,
  listDonations,
  listUpdates,
  createUpdate,
  updateUpdate,
  deleteUpdate,
  getMyAccount,
  updateMyAccount,

  addVerificationDocument,
  deleteVerificationDocument,
  submitAccount,
  adminListAccounts,
  adminUpdateAccountStatus,

  // payout
  listPayoutCatalog,
  listMyPayoutMethods,
  createMyPayoutMethod,
  updateMyPayoutMethod,
  deleteMyPayoutMethod,
  createWithdrawRequest,
  listMyWithdrawRequests,
  adminListWithdrawRequests,
  adminUpdateWithdrawRequestStatus,
};

export {};