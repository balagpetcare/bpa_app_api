const service = require('./posts.service');

exports.getFeed = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const posts = await service.getFeed({
      userId,
      limit: req.query.limit,
      cursor: req.query.cursor,
    });

    return res.status(200).json({ success: true, data: posts });
  } catch (e) {
    console.error('posts.getFeed error:', e);
    return res.status(500).json({ success: false, message: e.message || 'Failed' });
  }
};

// GET /api/v1/posts/user/:userId
exports.getUserFeed = async (req, res) => {
  try {
    const meId = req.user?.id;
    if (!meId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const userId = Number(req.params.userId);
    if (!userId) return res.status(400).json({ success: false, message: 'Invalid userId' });

    const posts = await service.getUserFeed({
      meId,
      userId,
      limit: req.query.limit,
      cursor: req.query.cursor,
    });

    return res.status(200).json({ success: true, data: posts });
  } catch (e) {
    console.error('posts.getUserFeed error:', e);
    const status = e.statusCode || 500;
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

// GET /api/v1/posts/:postId
exports.getById = async (req, res) => {
  try {
    const meId = req.user?.id;
    if (!meId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const postId = Number(req.params.postId);
    if (!postId) return res.status(400).json({ success: false, message: 'Invalid postId' });

    const post = await service.getPostById({ meId, postId });
    return res.status(200).json({ success: true, data: post });
  } catch (e) {
    console.error('posts.getById error:', e);
    const status = e.statusCode || 500;
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

// GET /api/v1/posts/user/:userId/photos
exports.getUserPhotos = async (req, res) => {
  try {
    const meId = req.user?.id;
    if (!meId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const userId = Number(req.params.userId);
    if (!userId) return res.status(400).json({ success: false, message: 'Invalid userId' });

    const data = await service.getUserMediaGallery({
      meId,
      userId,
      mediaType: 'IMAGE',
      limit: req.query.limit,
      cursor: req.query.cursor,
    });

    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error('posts.getUserPhotos error:', e);
    const status = e.statusCode || 500;
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

// GET /api/v1/posts/user/:userId/videos
exports.getUserVideos = async (req, res) => {
  try {
    const meId = req.user?.id;
    if (!meId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const userId = Number(req.params.userId);
    if (!userId) return res.status(400).json({ success: false, message: 'Invalid userId' });

    const data = await service.getUserMediaGallery({
      meId,
      userId,
      mediaType: 'VIDEO',
      limit: req.query.limit,
      cursor: req.query.cursor,
    });

    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error('posts.getUserVideos error:', e);
    const status = e.statusCode || 500;
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.create = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const created = await service.createPost({
      userId,
      caption: req.body.caption,
      type: req.body.type,
      category: req.body.category,
      mediaIds: req.body.mediaIds,
    });

    return res.status(201).json({ success: true, data: created });
  } catch (e) {
    const status = e.statusCode || 500;
    console.error('posts.create error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.update = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const updated = await service.updatePost({
      userId,
      postId: req.params.postId,
      caption: req.body.caption,
      type: req.body.type,
      category: req.body.category,
      mediaIds: req.body.mediaIds,
    });

    return res.status(200).json({ success: true, data: updated });
  } catch (e) {
    const status = e.statusCode || 500;
    console.error('posts.update error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.remove = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const result = await service.softDeletePost({ userId, postId: req.params.postId });
    return res.status(200).json({ success: true, data: result });
  } catch (e) {
    const status = e.statusCode || 500;
    console.error('posts.remove error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.like = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const counts = await service.like({ userId, postId: req.params.postId });
    return res.status(200).json({ success: true, data: { ...counts, isLikedByMe: true } });
  } catch (e) {
    console.error('posts.like error:', e);
    return res.status(500).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.unlike = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const counts = await service.unlike({ userId, postId: req.params.postId });
    return res.status(200).json({ success: true, data: { ...counts, isLikedByMe: false } });
  } catch (e) {
    console.error('posts.unlike error:', e);
    return res.status(500).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.listComments = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const list = await service.listComments({ userId, postId: req.params.postId, limit: req.query.limit });
    return res.status(200).json({ success: true, data: list });
  } catch (e) {
    console.error('posts.listComments error:', e);
    return res.status(500).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.addComment = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const created = await service.addComment({
      userId,
      postId: req.params.postId,
      text: req.body.text,
    });

    return res.status(201).json({ success: true, data: created });
  } catch (e) {
    const status = e.statusCode || 500;
    console.error('posts.addComment error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};


exports.likeComment = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const data = await service.likeComment({
      userId,
      postId: req.params.postId,
      commentId: req.params.commentId,
    });
    return res.status(200).json({ success: true, data: { ...data, isLikedByMe: true } });
  } catch (e) {
    const status = e.statusCode || 500;
    console.error('posts.likeComment error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.unlikeComment = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const data = await service.unlikeComment({
      userId,
      postId: req.params.postId,
      commentId: req.params.commentId,
    });
    return res.status(200).json({ success: true, data: { ...data, isLikedByMe: false } });
  } catch (e) {
    const status = e.statusCode || 500;
    console.error('posts.unlikeComment error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.replyComment = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const created = await service.replyComment({
      userId,
      postId: req.params.postId,
      commentId: req.params.commentId,
      text: req.body.text,
    });
    return res.status(201).json({ success: true, data: created });
  } catch (e) {
    const status = e.statusCode || 500;
    console.error('posts.replyComment error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};
