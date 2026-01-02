const prisma = require('../../../../infrastructure/db/prismaClient');

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function badRequest(res, message) {
  return res.status(400).json({ success: false, message });
}

exports.followUser = async (req, res) => {
  try {
    const me = req.user?.id;
    const targetId = toInt(req.params.userId);
    if (!me) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (!targetId) return badRequest(res, 'Invalid userId');
    if (targetId === me) return badRequest(res, 'You cannot follow yourself');

    await prisma.userFollow.upsert({
      where: { followerId_followingId: { followerId: me, followingId: targetId } },
      update: {},
      create: { followerId: me, followingId: targetId },
    });

    // best-effort cache update
    await prisma.userStatsCache.upsert({
      where: { userId: targetId },
      update: { followersCount: { increment: 1 } },
      create: { userId: targetId, followersCount: 1, followingCount: 0, petsCount: 0, pawPoints: 0 },
    }).catch(() => {});

    await prisma.userStatsCache.upsert({
      where: { userId: me },
      update: { followingCount: { increment: 1 } },
      create: { userId: me, followersCount: 0, followingCount: 1, petsCount: 0, pawPoints: 0 },
    }).catch(() => {});

    return res.json({ success: true, message: 'Followed' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to follow user' });
  }
};

exports.unfollowUser = async (req, res) => {
  try {
    const me = req.user?.id;
    const targetId = toInt(req.params.userId);
    if (!me) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (!targetId) return badRequest(res, 'Invalid userId');

    const deleted = await prisma.userFollow.deleteMany({
      where: { followerId: me, followingId: targetId },
    });

    if (deleted.count > 0) {
      await prisma.userStatsCache.update({ where: { userId: targetId }, data: { followersCount: { decrement: 1 } } }).catch(() => {});
      await prisma.userStatsCache.update({ where: { userId: me }, data: { followingCount: { decrement: 1 } } }).catch(() => {});
    }

    return res.json({ success: true, message: 'Unfollowed' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to unfollow user' });
  }
};

exports.likeUserProfile = async (req, res) => {
  try {
    const me = req.user?.id;
    const targetId = toInt(req.params.userId);
    if (!me) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (!targetId) return badRequest(res, 'Invalid userId');
    if (targetId === me) return badRequest(res, 'You cannot like your own profile');

    await prisma.userProfileLike.upsert({
      where: { userId_likedByUserId: { userId: targetId, likedByUserId: me } },
      update: {},
      create: { userId: targetId, likedByUserId: me },
    });

    return res.json({ success: true, message: 'Liked' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to like profile' });
  }
};

exports.unlikeUserProfile = async (req, res) => {
  try {
    const me = req.user?.id;
    const targetId = toInt(req.params.userId);
    if (!me) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (!targetId) return badRequest(res, 'Invalid userId');

    await prisma.userProfileLike.deleteMany({ where: { userId: targetId, likedByUserId: me } });
    return res.json({ success: true, message: 'Unliked' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to unlike profile' });
  }
};

exports.sendFriendRequest = async (req, res) => {
  try {
    const me = req.user?.id;
    const toUserId = toInt(req.params.userId);
    if (!me) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (!toUserId) return badRequest(res, 'Invalid userId');
    if (toUserId === me) return badRequest(res, 'You cannot send a request to yourself');

    // already friends?
    const pair = me < toUserId ? { userAId: me, userBId: toUserId } : { userAId: toUserId, userBId: me };
    const existingFriend = await prisma.userFriend.findUnique({ where: { userAId_userBId: pair } });
    if (existingFriend) return badRequest(res, 'Already friends');

    // prevent duplicate pending
    const existingPending = await prisma.userFriendRequest.findFirst({
      where: {
        fromUserId: me,
        toUserId,
        status: 'PENDING',
      },
      select: { id: true },
    });
    if (existingPending) {
      return res.json({ success: true, message: 'Request already sent', data: { requestId: existingPending.id } });
    }

    const reqRow = await prisma.userFriendRequest.create({
      data: { fromUserId: me, toUserId },
      select: { id: true },
    });

    return res.status(201).json({ success: true, message: 'Friend request sent', data: { requestId: reqRow.id } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to send friend request' });
  }
};

exports.acceptFriendRequest = async (req, res) => {
  try {
    const me = req.user?.id;
    const requestId = toInt(req.params.requestId);
    if (!me) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (!requestId) return badRequest(res, 'Invalid requestId');

    const fr = await prisma.userFriendRequest.findUnique({ where: { id: requestId } });
    if (!fr) return res.status(404).json({ success: false, message: 'Request not found' });
    if (fr.toUserId !== me) return res.status(403).json({ success: false, message: 'Forbidden' });
    if (fr.status !== 'PENDING') return badRequest(res, 'Request is not pending');

    const pair = fr.fromUserId < fr.toUserId ? { userAId: fr.fromUserId, userBId: fr.toUserId } : { userAId: fr.toUserId, userBId: fr.fromUserId };

    await prisma.$transaction([
      prisma.userFriendRequest.update({ where: { id: requestId }, data: { status: 'ACCEPTED', respondedAt: new Date() } }),
      prisma.userFriend.upsert({
        where: { userAId_userBId: pair },
        update: {},
        create: { ...pair },
      }),
    ]);

    return res.json({ success: true, message: 'Request accepted' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to accept friend request' });
  }
};

exports.rejectFriendRequest = async (req, res) => {
  try {
    const me = req.user?.id;
    const requestId = toInt(req.params.requestId);
    if (!me) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (!requestId) return badRequest(res, 'Invalid requestId');

    const fr = await prisma.userFriendRequest.findUnique({ where: { id: requestId } });
    if (!fr) return res.status(404).json({ success: false, message: 'Request not found' });
    if (fr.toUserId !== me) return res.status(403).json({ success: false, message: 'Forbidden' });
    if (fr.status !== 'PENDING') return badRequest(res, 'Request is not pending');

    await prisma.userFriendRequest.update({ where: { id: requestId }, data: { status: 'REJECTED', respondedAt: new Date() } });
    return res.json({ success: true, message: 'Request rejected' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to reject friend request' });
  }
};

exports.cancelFriendRequest = async (req, res) => {
  try {
    const me = req.user?.id;
    const requestId = toInt(req.params.requestId);
    if (!me) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (!requestId) return badRequest(res, 'Invalid requestId');

    const fr = await prisma.userFriendRequest.findUnique({ where: { id: requestId } });
    if (!fr) return res.status(404).json({ success: false, message: 'Request not found' });
    if (fr.fromUserId !== me) return res.status(403).json({ success: false, message: 'Forbidden' });
    if (fr.status !== 'PENDING') return badRequest(res, 'Request is not pending');

    await prisma.userFriendRequest.update({ where: { id: requestId }, data: { status: 'CANCELED', respondedAt: new Date() } });
    return res.json({ success: true, message: 'Request canceled' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to cancel friend request' });
  }
};

exports.getSocialStatus = async (req, res) => {
  try {
    const me = req.user?.id;
    const targetId = toInt(req.params.userId);
    if (!me) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (!targetId) return badRequest(res, 'Invalid userId');

    const [following, liked, friend, outgoingReq, incomingReq] = await Promise.all([
      prisma.userFollow.findUnique({ where: { followerId_followingId: { followerId: me, followingId: targetId } }, select: { id: true } }),
      prisma.userProfileLike.findUnique({ where: { userId_likedByUserId: { userId: targetId, likedByUserId: me } }, select: { id: true } }),
      prisma.userFriend.findUnique({
        where: {
          userAId_userBId: me < targetId ? { userAId: me, userBId: targetId } : { userAId: targetId, userBId: me },
        },
        select: { id: true },
      }),
      prisma.userFriendRequest.findFirst({
        where: { fromUserId: me, toUserId: targetId, status: 'PENDING' },
        select: { id: true },
      }),
      prisma.userFriendRequest.findFirst({
        where: { fromUserId: targetId, toUserId: me, status: 'PENDING' },
        select: { id: true },
      }),
    ]);

    return res.json({
      success: true,
      data: {
        isFollowing: Boolean(following),
        isLiked: Boolean(liked),
        isFriend: Boolean(friend),
        outgoingRequestId: outgoingReq?.id || null,
        incomingRequestId: incomingReq?.id || null,
      },
    });
  } catch (e) {
    const msg = (e && e.message) ? String(e.message) : 'Unknown error';
    // If migrations are not applied yet, Prisma throws "relation ... does not exist".
    const looksLikeMigrationIssue =
      msg.toLowerCase().includes('does not exist') ||
      msg.toLowerCase().includes('relation') ||
      msg.toLowerCase().includes('prisma');

    // Don't break the app UI; return safe defaults with a warning flag.
    if (looksLikeMigrationIssue) {
      return res.json({
        success: true,
        warning: 'Social tables not found. Run prisma migrate.',
        data: {
          isFollowing: false,
          isLiked: false,
          isFriend: false,
          outgoingRequestId: null,
          incomingRequestId: null,
          needsMigration: true,
        },
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to load social status',
      ...(process.env.NODE_ENV !== 'production' ? { error: msg } : {}),
    });
  }
};
