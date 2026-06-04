/**
 * Campaign export HTTP handlers.
 */

import type { Request, Response, NextFunction } from "express";
import { contentTypeForFormat } from "../../utils/campaignExportFormats";
import {
  buildBookingsExport,
  buildAnalyticsExport,
  parseBookingExportQuery,
} from "./export.service";
import { parseExportFormat } from "../../utils/campaignExportFormats";

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export async function exportCampaignBookingsHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const campaignId = parseInt(routeParam(req.params.campaignId), 10);
    if (!Number.isFinite(campaignId)) {
      return res.status(400).json({ success: false, error: "Invalid campaign id" });
    }
    const { format, filters } = parseBookingExportQuery(req.query as Record<string, unknown>);
    const { buffer, filename, rowCount } = await buildBookingsExport(
      campaignId,
      format,
      filters
    );
    res.setHeader("Content-Type", contentTypeForFormat(format));
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Export-Row-Count", String(rowCount));
    return res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
}

export async function exportCampaignAnalyticsHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const campaignId = parseInt(routeParam(req.params.campaignId), 10);
    if (!Number.isFinite(campaignId)) {
      return res.status(400).json({ success: false, error: "Invalid campaign id" });
    }
    const format = parseExportFormat(req.query.format);
    const { buffer, filename } = await buildAnalyticsExport(campaignId, format);
    res.setHeader("Content-Type", contentTypeForFormat(format));
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
}
