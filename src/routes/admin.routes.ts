import type { Response } from "express";
import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth";
import { authRequired } from "../middleware/auth";
import { fail, ok } from "../lib/http";
import * as adminPartner from "../modules/adminPartner/adminPartner.service";
import { logAudit } from "../modules/audit/audit.service";

export function adminRoutes() {
  const r = Router();

  // NOTE: platform admin check may be added later
  r.get("/partner-applications", authRequired, async (req: AuthedRequest, res: Response) => {
    const status = String(req.query.status || "");
    const rows = await adminPartner.list(status || undefined);
    return ok(res, { items: rows });
  });

  r.post("/partner-applications/:id/approve", authRequired, async (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    const adminId = req.user!.id;
    const updated = await adminPartner.approve(adminId, id);

    await logAudit({
      req: req as any,
      action: "APPROVE",
      entityType: "PARTNER_APPLICATION" as any,
      entityId: id,
      after: updated as any,
    });

    return ok(res, { item: updated });
  });

  r.post("/partner-applications/:id/reject", authRequired, async (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    const adminId = req.user!.id;
    const note = (req.body?.note ? String(req.body.note) : undefined);
    const updated = await adminPartner.reject(adminId, id, note);

    await logAudit({
      req: req as any,
      action: "REJECT",
      entityType: "PARTNER_APPLICATION" as any,
      entityId: id,
      after: updated as any,
    });

    return ok(res, { item: updated });
  });

  return r;
}
