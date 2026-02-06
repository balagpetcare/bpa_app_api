/**
 * Owner KYC Expiry & Data Retention Job
 *
 * Runs daily to:
 * 1. Find OwnerKyc with status SUBMITTED or REJECTED and expiresAt < now
 * 2. Soft-delete their organizations (deletedAt = now, deletionScheduledAt = now + grace days)
 * 3. Set OwnerKyc.verificationStatus = EXPIRED (and optionally lock)
 * 4. After grace period: hard-delete organizations where deletionScheduledAt < now
 *
 * User account is never deleted; only business-related data is removed.
 * Env: KYC_EXPIRY_DAYS (default 45), KYC_RETENTION_GRACE_DAYS (default 7)
 */

const prisma = require("../../infrastructure/db/prismaClient").default;

const KYC_RETENTION_GRACE_DAYS = Number(process.env.KYC_RETENTION_GRACE_DAYS || 7);

export async function runKycExpiryRetentionJob() {
  const startTime = Date.now();
  console.log("[JOB] Starting kycExpiryRetention job...");

  try {
    const now = new Date();

    // Step 1: Find expired OwnerKyc (not yet marked EXPIRED)
    const expiredKycs = await prisma.ownerKyc.findMany({
      where: {
        verificationStatus: { in: ["SUBMITTED", "REJECTED"] },
        expiresAt: { lt: now },
      },
      select: { id: true, userId: true, fullName: true },
    });

    let softDeletedOrgs = 0;
    for (const kyc of expiredKycs) {
      await prisma.$transaction(async (tx) => {
        // Mark OwnerKyc as EXPIRED
        await tx.ownerKyc.update({
          where: { id: kyc.id },
          data: {
            verificationStatus: "EXPIRED",
            isLocked: true,
            lockReason: "KYC expired; business data scheduled for removal.",
          },
        });

        // Soft-delete all organizations owned by this user
        const graceAt = new Date(now.getTime() + KYC_RETENTION_GRACE_DAYS * 24 * 60 * 60 * 1000);
        const result = await tx.organization.updateMany({
          where: {
            ownerUserId: kyc.userId,
            deletedAt: null,
          },
          data: {
            deletedAt: now,
            deletionScheduledAt: graceAt,
          },
        });
        softDeletedOrgs += result.count;
      });
      console.log(`[JOB] KYC ${kyc.id} (user ${kyc.userId}) expired; orgs soft-deleted.`);
    }

    // Step 2: Hard-delete organizations past grace period (deletionScheduledAt was set to now+grace at soft-delete)
    const orgsToHardDelete = await prisma.organization.findMany({
      where: {
        deletedAt: { not: null },
        deletionScheduledAt: { lt: now },
      },
      select: { id: true, ownerUserId: true, name: true },
    });

    let hardDeleted = 0;
    for (const org of orgsToHardDelete) {
      try {
        await prisma.organization.delete({ where: { id: org.id } });
        hardDeleted++;
        console.log(`[JOB] Hard-deleted org ${org.id} (${org.name}).`);
      } catch (e) {
        console.error(`[JOB] Failed to hard-delete org ${org.id}:`, (e as Error)?.message);
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `[JOB] kycExpiryRetention completed in ${duration}ms. Expired KYCs: ${expiredKycs.length}, soft-deleted orgs: ${softDeletedOrgs}, hard-deleted: ${hardDeleted}.`
    );

    return {
      success: true,
      expiredKycs: expiredKycs.length,
      softDeletedOrgs,
      hardDeletedOrgs: hardDeleted,
      duration,
    };
  } catch (e) {
    console.error("[JOB] kycExpiryRetention failed:", (e as Error)?.message);
    throw e;
  }
}
