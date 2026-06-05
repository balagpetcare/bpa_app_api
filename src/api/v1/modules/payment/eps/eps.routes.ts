import { Router } from "express";
import {
  epsCallbackHandler,
  epsCallbackUrlsHandler,
  epsInitiateHandler,
  epsValidateHandler,
  epsWebhookHandler,
} from "./eps.controller";

const router = Router();

router.get("/callback-urls", epsCallbackUrlsHandler);
router.post("/initiate", epsInitiateHandler);
router.post("/validate", epsValidateHandler);
router.post("/webhook", epsWebhookHandler);
router.get("/webhook", epsWebhookHandler);
router.get("/callback/success", epsCallbackHandler("success"));
router.get("/callback/fail", epsCallbackHandler("fail"));
router.get("/callback/cancel", epsCallbackHandler("cancel"));

export default router;
module.exports = router;
