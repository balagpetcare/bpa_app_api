const router = require("express").Router();
const { authLimiter } = require("../../../../middleware/rateLimiters");
const oauth = require("./oauth.controller");

router.post("/google", authLimiter, oauth.googleIdTokenLogin);
router.post("/facebook", authLimiter, oauth.facebookNotImplemented);
router.post("/apple", authLimiter, oauth.appleNotImplemented);
router.post("/twitter", authLimiter, oauth.twitterNotImplemented);

module.exports = router;

export {};
