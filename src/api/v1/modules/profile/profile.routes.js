const router = require("express").Router();
const auth = require("../../../../middleware/auth.middleware");
const profile = require("./profile.controller");

router.get("/me", auth, profile.getMyProfile);

// ✅ alias route (optional)
router.get("/profile", auth, profile.getMyProfile);

// ✅ update own profile (cover/avatar/displayName/etc)
router.patch("/me", auth, profile.updateMyProfile);
router.put("/me", auth, profile.updateMyProfile);

// ✅ view another user's profile by id (kept auth-protected to match app behavior)
router.get("/:id", auth, profile.getUserById);

module.exports = router;
