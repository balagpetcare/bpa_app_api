/**
 * One-time backfill: Set Branch.status = ACTIVE and Branch.verificationStatus = VERIFIED
 * for branches that are already verified (profile or branch) but were left non-ACTIVE
 * due to the previous approve flow only setting status to DRAFT.
 *
 * Run after deploying the fix that makes approveBranchKyc set status ACTIVE.
 *
 * Usage:
 *   npx ts-node scripts/backfill-branch-verified-to-active.ts
 *   # Dry run (no writes):
 *   DRY_RUN=1 npx ts-node scripts/backfill-branch-verified-to-active.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const isDryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

async function backfill() {
  console.log("[BACKFILL] Branch verified → active: finding branches that are VERIFIED but not ACTIVE.");
  if (isDryRun) console.log("[BACKFILL] DRY RUN – no updates will be written.");

  // Branches whose profile is VERIFIED but branch.status !== ACTIVE
  const profileVerified = await prisma.branchProfileDetails.findMany({
    where: { verificationStatus: "VERIFIED" },
    select: { branchId: true, branch: { select: { id: true, name: true, status: true, verificationStatus: true } } },
  });

  // Also branches with Branch.verificationStatus = VERIFIED and status !== ACTIVE (in case only Branch was set)
  const branchVerifiedInactive = await prisma.branch.findMany({
    where: {
      verificationStatus: "VERIFIED",
      status: { not: "ACTIVE" },
    },
    select: { id: true, name: true, status: true, verificationStatus: true },
  });

  const byId = new Map<number, { name: string; status: string; verificationStatus: string }>();
  for (const row of profileVerified) {
    if (row.branch && row.branch.status !== "ACTIVE") {
      byId.set(row.branchId, {
        name: row.branch.name,
        status: row.branch.status,
        verificationStatus: row.branch.verificationStatus ?? "",
      });
    }
  }
  for (const b of branchVerifiedInactive) {
    if (!byId.has(b.id)) {
      byId.set(b.id, { name: b.name, status: b.status, verificationStatus: b.verificationStatus ?? "" });
    }
  }

  const toUpdate = Array.from(byId.entries());
  if (toUpdate.length === 0) {
    console.log("[BACKFILL] No branches found that are VERIFIED but not ACTIVE. Nothing to do.");
    return;
  }

  console.log(`[BACKFILL] Found ${toUpdate.length} branch(es) to normalize to ACTIVE + VERIFIED.`);
  for (const [id, info] of toUpdate) {
    console.log(`  - Branch ${id} (${info.name}): status=${info.status}, verificationStatus=${info.verificationStatus}`);
  }

  if (isDryRun) {
    console.log("[BACKFILL] Dry run complete. Run without DRY_RUN=1 to apply.");
    return;
  }

  let updated = 0;
  for (const [branchId] of toUpdate) {
    try {
      await prisma.branch.update({
        where: { id: branchId },
        data: { status: "ACTIVE", verificationStatus: "VERIFIED" },
      });
      updated++;
      console.log(`[BACKFILL] Updated branch ${branchId} to status=ACTIVE, verificationStatus=VERIFIED.`);
    } catch (e) {
      console.error(`[BACKFILL] Failed to update branch ${branchId}:`, (e as Error).message);
    }
  }
  console.log(`[BACKFILL] Done. Updated ${updated} branch(es).`);
}

backfill()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[BACKFILL] Fatal:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
