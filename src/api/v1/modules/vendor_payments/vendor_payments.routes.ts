const express = require("express");
const controller = require("./vendor_payments.controller");
const authenticateToken = require("../../../../middleware/auth.middleware");

const vendorPaymentsRouter = express.Router();
vendorPaymentsRouter.use(authenticateToken);
vendorPaymentsRouter.post("/", controller.createVendorPayment);

module.exports = vendorPaymentsRouter;
