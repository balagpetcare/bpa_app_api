const router = require("express").Router();
const auth = require('../../../../middlewares/auth');
const ctrl = require("./me.controller");

router.get("/", auth, ctrl.getMe);

module.exports = router;

export {};
