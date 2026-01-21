import { Router, type Request, type Response } from "express";
import { authRequired, type AuthedRequest } from "../middleware/auth";
import { fail, ok } from "../lib/http";
import * as partnerSvc from "../modules/partner/partner.service";

export function partnerRoutes() {
  const r = Router();

  r.get("/me/application", authRequired, async (req: AuthedRequest, res: Response) => {
    const uid = req.user!.id;
    const app = await partnerSvc.getMyApplication(uid);
    return ok(res, { application: app });
  });

  r.post("/me/application/draft", authRequired, async (req: AuthedRequest, res: Response) => {
    const uid = req.user!.id;
    const updated = await partnerSvc.saveDraft(uid, req.body || {});
    return ok(res, { application: updated });
  });

  r.post("/me/application/submit", authRequired, async (req: AuthedRequest, res: Response) => {
    const uid = req.user!.id;
    const submitted = await partnerSvc.submit(uid);
    return ok(res, { application: submitted });
  });

  return r;
}
