const router = require('express').Router();

const auth = require('../../../../middleware/auth.middleware');
const posts = require('./posts.controller');

// Feed (home page)
router.get('/feed', auth, posts.getFeed);

// User feed (profile page)
router.get('/user/:userId', auth, posts.getUserFeed);

// Profile media helpers
router.get('/user/:userId/photos', auth, posts.getUserPhotos);
router.get('/user/:userId/videos', auth, posts.getUserVideos);

// Create post
router.post('/', auth, posts.create);

// Single post
router.get('/:postId', auth, posts.getById);

// Edit / delete (soft)
router.patch('/:postId', auth, posts.update);
router.delete('/:postId', auth, posts.remove);

// Single post
router.get('/:postId', auth, posts.getById);

// Like/unlike
router.post('/:postId/like', auth, posts.like);
router.delete('/:postId/like', auth, posts.unlike);

// Comments
router.get('/:postId/comments', auth, posts.listComments);
router.post('/:postId/comments', auth, posts.addComment);

// Comment likes + replies (1-level)
router.post('/:postId/comments/:commentId/like', auth, posts.likeComment);
router.delete('/:postId/comments/:commentId/like', auth, posts.unlikeComment);
router.post('/:postId/comments/:commentId/replies', auth, posts.replyComment);

module.exports = router;

export {};
