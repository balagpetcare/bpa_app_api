/**
 * Optional guard: require Owner KYC status VERIFIED for sensitive actions
 * (go-live, wallet withdraw, payouts, ads). Use after auth + role OWNER.
 * Does not run for non-owners (pass-through).
 */

const prisma = require("../infrastructure/db/prismaClient").default;

export async function requireOwnerKycVerified(req: any, res: any, next: any) {
  try {
    const userId = Number(req.user?.id || req.auth?.userId || 0);
    if (!userId) return next();

    const kyc = await prisma.ownerKyc.findUnique({
      where: { userId },
      select: { verificationStatus: true, isLocked: true, deletedAt: true },
    });

    // Not an owner (no KYC row) → allow; gating only applies to owners
    if (!kyc || kyc.deletedAt) return next();

    const status = String(kyc.verificationStatus || "").toUpperCase();
    if (status !== "VERIFIED" || kyc.isLocked) {
      return res.status(403).json({
        success: false,
        code: "KYC_VERIFIED_REQUIRED",
        message: "Owner KYC must be approved (verified) before this action. You can continue setting up branches and products while pending.",
        data: { verificationStatus: status },
      });
    }

    return next();
  } catch (e) {
    return res.status(500).json({ success: false, message: "KYC check failed" });
  }
}

module.exports = requireOwnerKycVerified;
