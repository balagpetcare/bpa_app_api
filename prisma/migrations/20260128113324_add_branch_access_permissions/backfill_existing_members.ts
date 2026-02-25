/**
 * Backfill Script: Create APPROVED BranchAccessPermission for existing BranchMember records
 * 
 * This script should be run after the migration to grant existing staff members
 * APPROVED access to their branches (grandfathered access).
 * 
 * Usage:
 *   npx ts-node prisma/migrations/20260128113324_add_branch_access_permissions/backfill_existing_members.ts
 * 
 * Or via npm script:
 *   npm run backfill:branch-access
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function backfillExistingMembers() {
  console.log("[BACKFILL] Starting backfill of existing BranchMember records...");

  try {
    // Get all active branch members
    const branchMembers = await prisma.branchMember.findMany({
      where: {
        status: "ACTIVE",
      },
      select: {
        id: true,
        branchId: true,
        userId: true,
        createdAt: true,
      },
    });

    console.log(`[BACKFILL] Found ${branchMembers.length} active branch members.`);

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const member of branchMembers) {
      try {
        // Check if permission already exists
        const existing = await prisma.branchAccessPermission.findUnique({
          where: {
            branchId_userId: {
              branchId: member.branchId,
              userId: member.userId,
            },
          },
        });

        if (existing) {
          console.log(
            `[BACKFILL] Skipping branch ${member.branchId}, user ${member.userId} - permission already exists`
          );
          skipped++;
          continue;
        }

        // Create APPROVED permission with createdAt as approvedAt (grandfathered)
        await prisma.branchAccessPermission.create({
          data: {
            branchId: member.branchId,
            userId: member.userId,
            status: "APPROVED",
            requestedAt: member.createdAt,
            approvedAt: member.createdAt, // Grandfathered - approved at creation time
            // No expiration date for existing members
            expiresAt: null,
          },
        });

        created++;
        if (created % 100 === 0) {
          console.log(`[BACKFILL] Processed ${created} permissions...`);
        }
      } catch (error: any) {
        console.error(
          `[BACKFILL] Error processing branch ${member.branchId}, user ${member.userId}:`,
          error.message
        );
        errors++;
      }
    }

    console.log("\n[BACKFILL] Summary:");
    console.log(`  Created: ${created}`);
    console.log(`  Skipped: ${skipped}`);
    console.log(`  Errors: ${errors}`);
    console.log(`  Total: ${branchMembers.length}`);

    return {
      success: true,
      created,
      skipped,
      errors,
      total: branchMembers.length,
    };
  } catch (error) {
    console.error("[BACKFILL] Fatal error:", error);
    return {
      success: false,
      error: String(error),
    };
  } finally {
    await prisma.$disconnect();
  }
}

// Run if executed directly
if (require.main === module) {
  backfillExistingMembers()
    .then((result) => {
      if (result.success) {
        console.log("\n[BACKFILL] ✅ Backfill completed successfully!");
        process.exit(0);
      } else {
        console.error("\n[BACKFILL] ❌ Backfill failed!");
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error("[BACKFILL] Fatal error:", error);
      process.exit(1);
    });
}

export { backfillExistingMembers };
