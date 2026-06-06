import { Router, type Request, type Response, type NextFunction } from "express";
import {
  epsCallbackHandler,
  epsCallbackUrlsHandler,
  epsInitiateHandler,
  epsValidateHandler,
  epsVerifyByTransactionIdHandler,
  epsWebhookHandler,
} from "./eps.controller";
import { formatProviderNotConfiguredMessage } from "../../../providers/paymentProvider.config";
import { isEpsModuleConfigured } from "./eps.config";

const router = Router();

function requireEpsConfigured(req: Request, res: Response, next: NextFunction) {
  if (!isEpsModuleConfigured()) {
    return res.status(503).json({
      success: false,
      error: {
        code: "EPS_NOT_CONFIGURED",
        message: formatProviderNotConfiguredMessage("eps"),
      },
    });
  }
  next();
}

router.get("/callback-urls", epsCallbackUrlsHandler);
router.post("/initiate", requireEpsConfigured, epsInitiateHandler);
router.post("/validate", requireEpsConfigured, epsValidateHandler);
router.get("/verify/:transactionId", requireEpsConfigured, epsVerifyByTransactionIdHandler);
router.post("/webhook", requireEpsConfigured, epsWebhookHandler);
router.get("/webhook", requireEpsConfigured, epsWebhookHandler);
router.get("/callback/success", requireEpsConfigured, epsCallbackHandler("success"));
router.get("/callback/fail", requireEpsConfigured, epsCallbackHandler("fail"));
router.get("/callback/cancel", requireEpsConfigured, epsCallbackHandler("cancel"));
router.get("/success", requireEpsConfigured, epsCallbackHandler("success"));
router.get("/fail", requireEpsConfigured, epsCallbackHandler("fail"));
router.get("/cancel", requireEpsConfigured, epsCallbackHandler("cancel"));

export default router;
module.exports = router;
