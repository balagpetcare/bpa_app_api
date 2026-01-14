import { Router } from "express";
import { requireAuth } from "../../middlewares/requireAuth";
import * as c from "./partner.controller";

const r = Router();

r.post("/applications/draft", requireAuth, c.createOrGetDraft);
r.get("/applications", requireAuth, c.listMine);
r.get("/applications/:id", requireAuth, c.getOneMine);
r.patch("/applications/:id", requireAuth, c.updateDraftMine);
r.post("/applications/:id/submit", requireAuth, c.submitMine);

export default r;
