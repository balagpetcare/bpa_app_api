const router = require("express").Router();
const auth = require('../../../../middlewares/auth');
const ctrl = require("./branches.controller");

router.post("/:branchId/product-change-requests", auth, ctrl.createProductChangeRequest);

module.exports = router;

export {};
