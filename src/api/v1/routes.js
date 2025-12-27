const router = require("express").Router();

router.use("/auth", require("./modules/auth/auth.routes"));
router.use("/common", require("./modules/common/common.routes"));
router.use("/user", require("./modules/profile/profile.routes"));
router.use("/user/pets", require("./modules/pets/pets.routes"));

// Media 

router.use("/media", require("./modules/media/media.routes"));



module.exports = router;
