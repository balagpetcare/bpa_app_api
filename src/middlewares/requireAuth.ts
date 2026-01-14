import { Request, Response, NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.id) return res.status(401).json({ message: "Unauthorized" });
  next();
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const perms = req.user?.permissions || [];
    if (!perms.includes(permission)) return res.status(403).json({ message: "Forbidden" });
    next();
  };
}
