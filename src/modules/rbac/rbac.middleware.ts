import type { Request, Response, NextFunction } from "express";
import { getAuthContext } from "../auth/auth_context";

function forbidden(message = "Forbidden") {
  return Object.assign(new Error(message), { statusCode: 403 });
}

function unauth(message = "Unauthenticated") {
  return Object.assign(new Error(message), { statusCode: 401 });
}

/**
 * Require a permission key.
 * Example: requirePerm("branch.read")
 */
export function requirePerm(perm: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const ctx = await getAuthContext(req);
      // @ts-ignore attach
      req.auth = ctx;

      if (!ctx.userId) throw unauth();
      const perms = ctx.permissions || [];
      if (!perms.includes(perm)) throw forbidden(`Missing permission: ${perm}`);

      return next();
    } catch (e) {
      return next(e);
    }
  };
}

/**
 * Require any one of the provided permissions.
 */
export function requireAnyPerm(perms: string[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const ctx = await getAuthContext(req);
      // @ts-ignore
      req.auth = ctx;

      if (!ctx.userId) throw unauth();
      const userPerms = ctx.permissions || [];
      const ok = perms.some((p) => userPerms.includes(p));
      if (!ok) throw forbidden(`Missing any permission: ${perms.join(", ")}`);

      return next();
    } catch (e) {
      return next(e);
    }
  };
}