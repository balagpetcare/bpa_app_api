import { Response } from "express";

export function ok(res: Response, data: any) {
  return res.json({ success: true, data });
}

export function fail(res: Response, status: number, message: string, details?: any) {
  return res.status(status).json({ success: false, error: { message, details } });
}
