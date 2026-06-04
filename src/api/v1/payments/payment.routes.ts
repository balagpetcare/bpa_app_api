import { Router } from "express";
import {
  callbackUrlsHandler,
  createPaymentHandler,
  sslRedirectHandler,
  verifyPaymentHandler,
  webhookGetHandler,
  webhookPostHandler,
} from "./payment.controller";

const router = Router();

router.get("/callback-urls", callbackUrlsHandler);
router.post("/create", createPaymentHandler);
router.post("/verify", verifyPaymentHandler);
router.post("/webhook", webhookPostHandler);
router.get("/webhook", webhookGetHandler);
router.get("/webhook/redirect/success", sslRedirectHandler("success"));
router.get("/webhook/redirect/fail", sslRedirectHandler("fail"));
router.get("/webhook/redirect/cancel", sslRedirectHandler("cancel"));

export default router;
module.exports = router;
