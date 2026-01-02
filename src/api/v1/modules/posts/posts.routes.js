const router = require('express').Router();

const auth = require('../../../../middleware/auth.middleware');
const posts = require('./posts.controller');

// Feed (home page)
router.get('/feed', auth, posts.getFeed);

// Create post
router.post('/', auth, posts.create);

// Edit / delete (soft)
router.patch('/:postId', auth, posts.update);
router.delete('/:postId', auth, posts.remove);

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
