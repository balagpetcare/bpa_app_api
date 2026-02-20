const prisma = require("../infrastructure/db/prismaClient");

/**
 * Enforces mandatory Owner KYC for sensitive owner actions (org/branch creation & submission).
 *
 * Rules:
 * - Owner must have an OwnerKyc row
 * - verificationStatus must be SUBMITTED or VERIFIED (pending = SUBMITTED allows onboarding continuation)
 * - must not be locked/deleted
 * - must have at least 1 uploaded KYC document
 *
 * Pending (SUBMITTED) owners can create org/branch, add drafts; go-live/payout/ads require VERIFIED (see feature gating).
 */
module.exports = async function ensureOwnerKyc(req, res, next) {
  try {
    const userId = Number(req.user?.id || 0);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const kyc = await prisma.ownerKyc.findUnique({
      where: { userId },
      select: {
        id: true,
        verificationStatus: true,
        isLocked: true,
        deletedAt: true,
        documents: { select: { id: true }, take: 1 },
      },
    });

    if (!kyc || kyc.deletedAt) {
      return res.status(403).json({
        success: false,
        code: "KYC_REQUIRED",
        message: "Owner KYC is required before you can register organizations/branches.",
      });
    }

    if (kyc.isLocked) {
      return res.status(403).json({
        success: false,
        code: "KYC_LOCKED",
        message: "Owner KYC is locked. Please contact support.",
      });
    }

    const status = String(kyc.verificationStatus || "UNSUBMITTED").toUpperCase();
    const ok = status === "SUBMITTED" || status === "VERIFIED";
    if (!ok) {
      return res.status(403).json({
        success: false,
        code: "KYC_NOT_SUBMITTED",
        message: "Please submit your KYC before you can register organizations/branches.",
        data: { verificationStatus: status },
      });
    }

    const hasDoc = Array.isArray(kyc.documents) && kyc.documents.length > 0;
    if (!hasDoc) {
      return res.status(403).json({
        success: false,
        code: "KYC_DOCUMENT_REQUIRED",
        message: "Please upload required KYC documents before continuing.",
      });
    }

    return next();
  } catch (e) {
    return res.status(500).json({ success: false, message: "KYC check failed" });
  }
};

export {};
