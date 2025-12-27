const router = require("express").Router();
const auth = require("../../../../middleware/auth.middleware");
const profile = require("./profile.controller");

router.get("/me", auth, profile.getMyProfile);

// ✅ alias route (optional)
router.get("/profile", auth, profile.getMyProfile);

module.exports = router;
