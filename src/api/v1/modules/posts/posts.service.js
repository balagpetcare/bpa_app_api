const prisma = require('../../../../infrastructure/db/prismaClient');

function normalizePostType(type) {
  const t = String(type || '').toUpperCase();
  const allowed = ['TEXT', 'IMAGE', 'VIDEO', 'REEL'];
  return allowed.includes(t) ? t : 'TEXT';
}

function normalizePostCategory(category) {
  const c = String(category || '').toUpperCase();
  const allowed = ['GENERAL', 'FUNDRAISING'];
  return allowed.includes(c) ? c : 'GENERAL';
}

async function getFeed({ userId, limit = 50, cursor }) {
  // Cursor pagination (optional)
  const take = Math.min(Number(limit) || 50, 100);
  // Exclude FUNDRAISING_UPDATE posts from the normal feed.
  // These are campaign updates and must only appear inside the campaign details screen.
  const where = { deletedAt: null, category: { not: 'FUNDRAISING_UPDATE' } };

  const args = {
    where,
    orderBy: { createdAt: 'desc' },
    take,
    include: {
      author: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
              username: true,
              avatarMedia: { select: { url: true } },
            },
          },
        },
      },
      media: {
        orderBy: { order: 'asc' },
        include: { media: { select: { id: true, url: true, type: true } } },
      },
      fundraisingCampaign: {
        select: {
          id: true,
          title: true,
          targetAmount: true,
          deadline: true,
          // category: true,
          locationText: true,
          account: { select: { status: true } },
          stats: { select: { raisedAmount: true, donorsCount: true } },
          donations: {
            take: 3,
            orderBy: { createdAt: 'desc' },
            select: {
              amount: true,
              createdAt: true,
              donor: {
                select: {
                  id: true,
                  profile: {
                    select: {
                      displayName: true,
                      username: true,
                      avatarMedia: { select: { url: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      // Like button state for the current user (optional)
      likes: userId
        ? {
            where: { userId: Number(userId) },
            select: { id: true },
            take: 1,
          }
        : false,
      _count: { select: { likes: true, comments: true } },
    },
  };

  if (cursor) {
    args.skip = 1;
    args.cursor = { id: Number(cursor) };
  }

  const posts = await prisma.post.findMany(args);
  // Add a computed field for the mobile app
  return posts.map((p) => ({
    ...p,
    isLikedByMe: Array.isArray(p.likes) && p.likes.length > 0,
    // keep payload small
    likes: undefined,
  }));
}

async function getUserFeed({ meId, userId, limit = 50, cursor }) {
  const take = Math.min(Number(limit) || 50, 100);
  const where = {
    deletedAt: null,
    authorId: Number(userId),
    category: { not: 'FUNDRAISING_UPDATE' },
  };

  const args = {
    where,
    orderBy: { createdAt: 'desc' },
    take,
    include: {
      author: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
              username: true,
              avatarMedia: { select: { url: true } },
            },
          },
        },
      },
      media: {
        orderBy: { order: 'asc' },
        include: { media: { select: { id: true, url: true, type: true } } },
      },
      fundraisingCampaign: {
        select: {
          id: true,
          title: true,
          targetAmount: true,
          deadline: true,
          locationText: true,
          account: { select: { status: true } },
          stats: { select: { raisedAmount: true, donorsCount: true } },
          donations: {
            take: 3,
            orderBy: { createdAt: 'desc' },
            select: {
              amount: true,
              createdAt: true,
              donor: {
                select: {
                  id: true,
                  profile: {
                    select: {
                      displayName: true,
                      username: true,
                      avatarMedia: { select: { url: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      likes: meId
        ? {
            where: { userId: Number(meId) },
            select: { id: true },
            take: 1,
          }
        : false,
      _count: { select: { likes: true, comments: true } },
    },
  };

  if (cursor) {
    args.skip = 1;
    args.cursor = { id: Number(cursor) };
  }

  const posts = await prisma.post.findMany(args);
  return posts.map((p) => ({
    ...p,
    isLikedByMe: Array.isArray(p.likes) && p.likes.length > 0,
    likes: undefined,
  }));
}

async function getPostById({ meId, postId }) {
  const id = Number(postId);
  const post = await prisma.post.findFirst({
    // Keep fundraising updates out of normal single post API.
    where: { id, deletedAt: null, category: { not: 'FUNDRAISING_UPDATE' } },
    include: {
      author: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
              username: true,
              avatarMedia: { select: { url: true } },
            },
          },
        },
      },
      media: {
        orderBy: { order: 'asc' },
        include: { media: { select: { id: true, url: true, type: true } } },
      },
      fundraisingCampaign: {
        select: {
          id: true,
          title: true,
          targetAmount: true,
          deadline: true,
          locationText: true,
          account: { select: { status: true } },
          stats: { select: { raisedAmount: true, donorsCount: true } },
          donations: {
            take: 3,
            orderBy: { createdAt: 'desc' },
            select: {
              amount: true,
              createdAt: true,
              donor: {
                select: {
                  id: true,
                  profile: {
                    select: {
                      displayName: true,
                      username: true,
                      avatarMedia: { select: { url: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      likes: meId
        ? {
            where: { userId: Number(meId) },
            select: { id: true },
            take: 1,
          }
        : false,
      _count: { select: { likes: true, comments: true } },
    },
  });

  if (!post) {
    const err = new Error('Post not found');
    err.statusCode = 404;
    throw err;
  }

  return {
    ...post,
    isLikedByMe: Array.isArray(post.likes) && post.likes.length > 0,
    likes: undefined,
  };
}

// Returns a light-weight media list for profile gallery screens.
// Shape: { items: [{ postId, mediaId, url, createdAt }], nextCursor }
async function getUserMediaGallery({ meId, userId, mediaType, limit = 50, cursor }) {
  const take = Math.min(Number(limit) || 50, 100);
  const type = String(mediaType || '').toUpperCase() === 'VIDEO' ? 'VIDEO' : 'IMAGE';

  // We paginate by post id (createdAt desc) to keep cursor simple.
  const where = {
    deletedAt: null,
    authorId: Number(userId),
    category: { not: 'FUNDRAISING_UPDATE' },
  };

  const args = {
    where,
    orderBy: { createdAt: 'desc' },
    take,
    include: {
      media: {
        orderBy: { order: 'asc' },
        include: { media: { select: { id: true, url: true, type: true } } },
      },
    },
  };
  if (cursor) {
    args.skip = 1;
    args.cursor = { id: Number(cursor) };
  }

  const posts = await prisma.post.findMany(args);
  const items = [];
  for (const p of posts) {
    for (const pm of p.media || []) {
      const m = pm.media;
      if (!m) continue;
      const mt = String(m.type || '').toUpperCase();
      if (type === 'IMAGE' && mt !== 'IMAGE') continue;
      if (type === 'VIDEO' && mt !== 'VIDEO') continue;
      if (!m.url) continue;
      items.push({
        postId: p.id,
        mediaId: m.id,
        url: m.url,
        createdAt: p.createdAt,
      });
    }
  }

  const nextCursor = posts.length === take ? String(posts[posts.length - 1].id) : null;
  return { items, nextCursor };
}

async function createPost({ userId, caption, type, category, mediaIds = [] }) {
  const requestedType = normalizePostType(type);
  const postCategory = normalizePostCategory(category);
  const trimmedCaption = typeof caption === 'string' ? caption.trim() : null;
  const ids = (Array.isArray(mediaIds) ? mediaIds : [])
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));

  if (requestedType !== 'TEXT' && ids.length === 0) {
    const err = new Error('mediaIds is required for IMAGE/VIDEO/REEL posts');
    err.statusCode = 400;
    throw err;
  }

  // Validate media existence/ownership and infer a safe post type from actual media.
  // This prevents situations like: client sends type=VIDEO but media is actually IMAGE,
  // which can cause clients to not render the post.
  let inferredType = requestedType;
  if (ids.length > 0) {
    const mediaRows = await prisma.media.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
      },
      select: { id: true, type: true, ownerUserId: true },
    });

    // Ensure all referenced media exist
    const foundIds = new Set(mediaRows.map((m) => m.id));
    const missing = ids.filter((id) => !foundIds.has(id));
    if (missing.length) {
      const err = new Error(`Invalid mediaIds: ${missing.join(', ')}`);
      err.statusCode = 400;
      throw err;
    }

    // Ensure media belongs to the caller (basic access control)
    const foreignMedia = mediaRows.find((m) => Number(m.ownerUserId) !== Number(userId));
    if (foreignMedia) {
      const err = new Error('One or more mediaIds do not belong to you');
      err.statusCode = 403;
      throw err;
    }

    const hasVideo = mediaRows.some((m) => String(m.type || '').toUpperCase() === 'VIDEO');
    inferredType = hasVideo ? 'VIDEO' : 'IMAGE';

    // If client asked for TEXT but provided media, upgrade to inferred.
    // If client asked for VIDEO/IMAGE but media indicates otherwise, we trust the media.
    if (requestedType === 'TEXT') {
      inferredType = hasVideo ? 'VIDEO' : 'IMAGE';
    }
  }

  // REEL behaves like VIDEO in our storage model
  const postType = requestedType === 'REEL' ? 'REEL' : inferredType;

  const created = await prisma.post.create({
    data: {
      authorId: Number(userId),
      caption: trimmedCaption,
      type: postType,
      category: postCategory,
      media: {
        create: ids.map((mediaId, idx) => ({
          mediaId,
          order: idx,
        })),
      },
    },
    include: {
      author: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
              username: true,
              avatarMedia: { select: { url: true } },
            },
          },
        },
      },
      media: {
        orderBy: { order: 'asc' },
        include: { media: { select: { id: true, url: true, type: true } } },
      },
      fundraisingCampaign: {
        select: { id: true },
      },
      likes: false,
      _count: { select: { likes: true, comments: true } },
    },
  });

  return { ...created, isLikedByMe: false };
}

async function updatePost({ userId, postId, caption, type, category, mediaIds }) {
  const id = Number(postId);
  const existing = await prisma.post.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, authorId: true, type: true },
  });
  if (!existing) {
    const err = new Error('Post not found');
    err.statusCode = 404;
    throw err;
  }
  if (existing.authorId !== Number(userId)) {
    const err = new Error('Forbidden');
    err.statusCode = 403;
    throw err;
  }

  const data = {};
  if (caption !== undefined) data.caption = (caption ?? '').toString().trim() || null;
  if (type !== undefined) data.type = normalizePostType(type);
  if (category !== undefined) data.category = normalizePostCategory(category);

  // If caller sends mediaIds, we replace post media order with the new list.
  // This keeps the API simple and deterministic.
  const ids = Array.isArray(mediaIds)
    ? mediaIds
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n > 0)
    : null;

  // If mediaIds is provided but type not provided, infer a safe type.
  if (ids && type === undefined) {
    if (ids.length === 0) {
      data.type = 'TEXT';
    } else {
      // Check if any uploaded media is VIDEO -> post type VIDEO
      const mediaRows = await prisma.media.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true, type: true },
      });
      const hasVideo = mediaRows.some((m) => (m.type || '').toUpperCase() === 'VIDEO');
      data.type = hasVideo ? 'VIDEO' : 'IMAGE';
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.post.update({
      where: { id },
      data,
    });

    if (ids) {
      await tx.postMedia.deleteMany({ where: { postId: id } });
      if (ids.length > 0) {
        await tx.postMedia.createMany({
          data: ids.map((mediaId, order) => ({ postId: id, mediaId, order })),
        });
      }
    }

    // Re-fetch with includes
    const full = await tx.post.findUnique({
      where: { id },
      include: {
        author: {
          select: {
            id: true,
            profile: {
              select: {
                displayName: true,
                username: true,
                avatarMedia: { select: { url: true } },
              },
            },
          },
        },
        media: {
          orderBy: { order: 'asc' },
          include: { media: { select: { id: true, url: true, type: true } } },
        },
        _count: { select: { likes: true, comments: true } },
      },
    });

    return full;
  });

  return { ...(updated || {}), isLikedByMe: false };
}

async function softDeletePost({ userId, postId }) {
  const id = Number(postId);
  const existing = await prisma.post.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, authorId: true },
  });
  if (!existing) {
    const err = new Error('Post not found');
    err.statusCode = 404;
    throw err;
  }
  if (existing.authorId !== Number(userId)) {
    const err = new Error('Forbidden');
    err.statusCode = 403;
    throw err;
  }

  await prisma.post.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return { id, deletedAt: true };
}

async function like({ userId, postId }) {
  await prisma.postLike.upsert({
    where: { postId_userId: { postId: Number(postId), userId: Number(userId) } },
    update: {},
    create: { postId: Number(postId), userId: Number(userId) },
  });
  const post = await prisma.post.findUnique({
    where: { id: Number(postId) },
    select: { _count: { select: { likes: true, comments: true } } },
  });
  return { likeCount: post?._count?.likes ?? 0, commentCount: post?._count?.comments ?? 0 };
}

async function unlike({ userId, postId }) {
  await prisma.postLike.deleteMany({
    where: { postId: Number(postId), userId: Number(userId) },
  });
  const post = await prisma.post.findUnique({
    where: { id: Number(postId) },
    select: { _count: { select: { likes: true, comments: true } } },
  });
  return { likeCount: post?._count?.likes ?? 0, commentCount: post?._count?.comments ?? 0 };
}

async function listComments({ userId, postId, limit = 50 }) {
  const comments = await prisma.postComment.findMany({
    where: { postId: Number(postId), deletedAt: null },
    orderBy: { createdAt: 'asc' },
    take: Math.min(Number(limit) || 50, 200),
    include: {
      user: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
              username: true,
              avatarMedia: { select: { url: true } },
            },
          },
        },
      },
      _count: { select: { likes: true } },
      likes: userId
        ? {
            where: { userId: Number(userId) },
            select: { id: true },
            take: 1,
          }
        : false,
    },
  });

  return comments.map((c) => ({
    ...c,
    likeCount: c._count?.likes ?? 0,
    isLikedByMe: Array.isArray(c.likes) && c.likes.length > 0,
    likes: undefined,
    _count: undefined,
  }));
}

async function addComment({ userId, postId, text, parentId }) {
  const t = String(text || '').trim();
  if (!t) {
    const err = new Error('Comment text is required');
    err.statusCode = 400;
    throw err;
  }
  const created = await prisma.postComment.create({
    data: {
      postId: Number(postId),
      userId: Number(userId),
      text: t,
      parentId: parentId ? Number(parentId) : null,
    },
    include: {
      user: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
              username: true,
              avatarMedia: { select: { url: true } },
            },
          },
        },
      },
    },
  });
  return created;
}



async function likeComment({ userId, commentId }) {
  await prisma.postCommentLike.upsert({
    where: { commentId_userId: { commentId: Number(commentId), userId: Number(userId) } },
    update: {},
    create: { commentId: Number(commentId), userId: Number(userId) },
  });
  const c = await prisma.postComment.findUnique({
    where: { id: Number(commentId) },
    select: { _count: { select: { likes: true } } },
  });
  return { likeCount: c?._count?.likes ?? 0 };
}

async function unlikeComment({ userId, commentId }) {
  await prisma.postCommentLike.deleteMany({ where: { commentId: Number(commentId), userId: Number(userId) } });
  const c = await prisma.postComment.findUnique({
    where: { id: Number(commentId) },
    select: { _count: { select: { likes: true } } },
  });
  return { likeCount: c?._count?.likes ?? 0 };
}

async function replyComment({ userId, postId, commentId, text }) {
  // Ensure parent exists
  const parent = await prisma.postComment.findFirst({
    where: { id: Number(commentId), postId: Number(postId), deletedAt: null },
    select: { id: true },
  });
  if (!parent) {
    const err = new Error('Comment not found');
    err.statusCode = 404;
    throw err;
  }
  return addComment({ userId, postId, text, parentId: commentId });
}

module.exports = {
  getFeed,
  getUserFeed,
  getPostById,
  getUserMediaGallery,
  createPost,
  updatePost,
  softDeletePost,
  like,
  unlike,
  listComments,
  addComment,
  likeComment,
  unlikeComment,
  replyComment,
};
