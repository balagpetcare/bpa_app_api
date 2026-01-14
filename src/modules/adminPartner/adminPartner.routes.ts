import { Router } from "express";
import { requireAuth, requirePermission } from "../../middlewares/requireAuth";
import * as c from "./adminPartner.controller";

const r = Router();

r.get("/applications", requireAuth, requirePermission("partner_app.read"), c.list);
r.post("/applications/:id/review", requireAuth, requirePermission("partner_app.review"), c.markUnderReview);
r.post("/applications/:id/approve", requireAuth, requirePermission("partner_app.approve"), c.approve);
r.post("/applications/:id/reject", requireAuth, requirePermission("partner_app.review"), c.reject);

export default r;
