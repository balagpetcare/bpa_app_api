import { NextFunction, Response } from "express";
import { AuthedRequest } from "./auth";
import { fail } from "../lib/http";

export function requirePermission(...required: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const perms = req.user?.permissions ?? [];
    const ok = required.every((r) => perms.includes(r));
    if (!ok) return fail(res, 403, "Forbidden: missing permission", { required, have: perms });
    return next();
  };
}
