const router = require('express').Router();
const auth = require('../../../../middleware/auth.middleware');
const social = require('./social.controller');

// Follow / unfollow
router.post('/follow/:userId', auth, social.followUser);
router.delete('/follow/:userId', auth, social.unfollowUser);

// Profile like / unlike
router.post('/like/:userId', auth, social.likeUserProfile);
router.delete('/like/:userId', auth, social.unlikeUserProfile);

// Friend requests
router.post('/friend-request/:userId', auth, social.sendFriendRequest);
router.post('/friend-request/:requestId/accept', auth, social.acceptFriendRequest);
router.post('/friend-request/:requestId/reject', auth, social.rejectFriendRequest);
router.delete('/friend-request/:requestId/cancel', auth, social.cancelFriendRequest);

// Status helper for UI (visitor profile buttons)
router.get('/status/:userId', auth, social.getSocialStatus);

module.exports = router;

export {};
