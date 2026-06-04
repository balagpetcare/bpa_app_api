/**
 * Campaign Link Routes — BPA app authenticated endpoints
 * POST/GET /api/v1/campaign-link/*
 */

import { Router, Request, Response, NextFunction } from "express";
const auth = require("../../../../middlewares/auth");

import {
  getCampaignLinkSummary,
  getMyCampaignBookings,
  getVaccinationRecords,
  getUpcomingVaccinations,
  linkCampaignRecordsToUser,
  linkExistingPet,
  claimCertificate,
  getPublicCampaignBenefits,
} from "./campaignLink.service";
import { getCertificateData, generateCertificatePdf } from "./certificate.service";

const router = Router();

router.use(auth);

function userId(req: Request): number {
  return Number((req as any).user?.id || 0);
}

router.get("/summary", async (req, res, next) => {
  try {
    const data = await getCampaignLinkSummary(userId(req));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.get("/my-bookings", async (req, res, next) => {
  try {
    const data = await getMyCampaignBookings(userId(req));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.get("/vaccinations", async (req, res, next) => {
  try {
    const data = await getVaccinationRecords(userId(req));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.get("/upcoming", async (req, res, next) => {
  try {
    const data = await getUpcomingVaccinations(userId(req));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.get("/benefits", async (req, res, next) => {
  try {
    const slug = req.query.slug as string | undefined;
    const data = await getPublicCampaignBenefits(slug);
    if (!data) {
      return res.status(404).json({
        success: false,
        error: { code: "CAMPAIGN_NOT_FOUND", message: "Campaign not found" },
      });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.post("/import", async (req, res, next) => {
  try {
    const result = await linkCampaignRecordsToUser(userId(req));
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/pet/:campaignPetId", async (req, res, next) => {
  try {
    const campaignPetId = parseInt(req.params.campaignPetId, 10);
    const { existingPetId } = req.body as { existingPetId?: number };
    if (!existingPetId) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_INPUT", message: "existingPetId required" },
      });
    }
    const result = await linkExistingPet(campaignPetId, existingPetId, userId(req));
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: { code: "LINK_FAILED", message: error?.message || "Link failed" },
    });
  }
});

router.post("/certificate/:token/claim", async (req, res, next) => {
  try {
    const result = await claimCertificate(req.params.token, userId(req));
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: { code: "CLAIM_FAILED", message: error?.message || "Claim failed" },
    });
  }
});

router.get("/certificates/:token", async (req, res, next) => {
  try {
    const data = await getCertificateData(req.params.token);
    if (!data) {
      return res.status(404).json({
        success: false,
        error: { code: "CERTIFICATE_NOT_FOUND", message: "Certificate not found" },
      });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.get("/certificates/:token/pdf", async (req, res, next) => {
  try {
    const pdf = await generateCertificatePdf(req.params.token);
    if (!pdf) {
      return res.status(404).json({
        success: false,
        error: { code: "PDF_UNAVAILABLE", message: "PDF generation unavailable" },
      });
    }
    res.json({ success: true, data: pdf });
  } catch (error) {
    next(error);
  }
});

router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({
    success: false,
    error: { code: "SERVER_ERROR", message: err.message || "Internal error" },
  });
});

export default router;
