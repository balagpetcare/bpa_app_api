/**
 * Require ProducerOrg to be VERIFIED before staff invite or other gated actions.
 * Pass-through for non-producer owners; blocks unverified producers with 403.
 */

const prisma = require("../../../infrastructure/db/prismaClient");

async function requireProducerVerified(req: any, res: any, next: any) {
  try {
    const userId = Number(req.user?.id || 0);
    if (!userId) return next();

    const producerOrg = await prisma.producerOrg.findFirst({
      where: { ownerUserId: userId },
      select: { id: true, status: true },
    });

    if (!producerOrg) return next();

    if (producerOrg.status !== "VERIFIED") {
      return res.status(403).json({
        success: false,
        code: "PRODUCER_VERIFICATION_REQUIRED",
        message: "Producer organization must be verified before inviting staff.",
        data: { status: producerOrg.status },
      });
    }

    return next();
  } catch (e) {
    return res.status(500).json({ success: false, message: "Verification check failed" });
  }
}

module.exports = requireProducerVerified;
