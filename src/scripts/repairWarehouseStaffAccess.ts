/**
 * Data Repair Script for Warehouse Staff Access
 * 
 * This script repairs existing warehouse staff records that were created
 * via the old broken flow (missing BranchMember and BranchAccessPermission).
 * 
 * Run this script after deploying the unified staff orchestration fixes.
 * 
 * Usage:
 *   npx ts-node src/scripts/repairWarehouseStaffAccess.ts [--dry-run]
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface RepairResult {
  userId: number;
  email: string | null;
  warehouseId: number;
  branchId: number;
  branchMemberCreated: boolean;
  accessPermissionCreated: boolean;
  errors: string[];
}

async function repairWarehouseStaffAccess(dryRun: boolean = false): Promise<RepairResult[]> {
  const results: RepairResult[] = [];

  console.log(`🔍 Scanning for warehouse staff with missing branch access...${dryRun ? " (DRY RUN)" : ""}`);

  // Find all active warehouse staff assignments
  const warehouseAssignments = await prisma.warehouseStaffAssignment.findMany({
    where: { isActive: true },
    include: {
      user: {
        include: {
          auth: { select: { email: true, phone: true } },
          profile: { select: { displayName: true } },
        },
      },
      warehouse: {
        select: { id: true, branchId: true, orgId: true, name: true },
      },
    },
  });

  console.log(`📊 Found ${warehouseAssignments.length} warehouse staff assignments`);

  for (const assignment of warehouseAssignments) {
    const { user, warehouse } = assignment;
    const result: RepairResult = {
      userId: user.id,
      email: user.auth?.email || null,
      warehouseId: warehouse.id,
      branchId: warehouse.branchId,
      branchMemberCreated: false,
      accessPermissionCreated: false,
      errors: [],
    };

    // Skip if warehouse not linked to a branch
    if (!warehouse.branchId) {
      result.errors.push("Warehouse not linked to a branch");
      results.push(result);
      continue;
    }

    try {
      // Check if BranchMember exists
      const existingBranchMember = await prisma.branchMember.findUnique({
        where: {
          branchId_userId: {
            branchId: warehouse.branchId,
            userId: user.id,
          },
        },
      });

      // Check if BranchAccessPermission exists
      const existingAccessPermission = await prisma.branchAccessPermission.findUnique({
        where: {
          branchId_userId: {
            branchId: warehouse.branchId,
            userId: user.id,
          },
        },
      });

      const needsRepair = !existingBranchMember || !existingAccessPermission;

      if (!needsRepair) {
        console.log(`  ✓ User ${user.id} (${user.auth?.email}) - already has full access`);
        continue;
      }

      console.log(`  🔧 Repairing user ${user.id} (${user.auth?.email || "no email"})...`);

      if (!dryRun) {
        // Create or update BranchMember
        if (!existingBranchMember) {
          await prisma.branchMember.create({
            data: {
              orgId: warehouse.orgId,
              branchId: warehouse.branchId,
              userId: user.id,
              role: assignment.role,
              status: "ACTIVE",
              invitedByUserId: 1, // System/admin
            },
          });
          result.branchMemberCreated = true;
          console.log(`    ✓ Created BranchMember (role: ${assignment.role})`);
        } else {
          // Ensure existing BranchMember is ACTIVE
          if (existingBranchMember.status !== "ACTIVE") {
            await prisma.branchMember.update({
              where: { id: existingBranchMember.id },
              data: { status: "ACTIVE" },
            });
            console.log(`    ✓ Updated BranchMember status to ACTIVE`);
          }
        }

        // Create or update BranchAccessPermission
        if (!existingAccessPermission) {
          await prisma.branchAccessPermission.create({
            data: {
              branchId: warehouse.branchId,
              userId: user.id,
              status: "APPROVED",
              invitedByUserId: 1, // System/admin
            },
          });
          result.accessPermissionCreated = true;
          console.log(`    ✓ Created BranchAccessPermission (APPROVED)`);
        } else {
          // Ensure existing permission is APPROVED
          if (existingAccessPermission.status !== "APPROVED") {
            await prisma.branchAccessPermission.update({
              where: { id: existingAccessPermission.id },
              data: { status: "APPROVED" },
            });
            console.log(`    ✓ Updated BranchAccessPermission status to APPROVED`);
          }
        }

        // Also update any old WAREHOUSE targetType invites to BRANCH
        const updatedInvites = await prisma.staffInvite.updateMany({
          where: {
            targetType: "WAREHOUSE",
            acceptedByUserId: user.id,
            warehouseId: warehouse.id,
          },
          data: {
            targetType: "BRANCH",
            branchId: warehouse.branchId,
          },
        });
        
        if (updatedInvites.count > 0) {
          console.log(`    ✓ Updated ${updatedInvites.count} invite records to targetType=BRANCH`);
        }
      } else {
        // Dry run - just report what would be done
        if (!existingBranchMember) {
          console.log(`    ⏳ Would create BranchMember (role: ${assignment.role})`);
        }
        if (!existingAccessPermission) {
          console.log(`    ⏳ Would create BranchAccessPermission (APPROVED)`);
        }
      }

      results.push(result);
    } catch (err: any) {
      result.errors.push(err.message);
      console.error(`    ✗ Error repairing user ${user.id}:`, err.message);
      results.push(result);
    }
  }

  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  console.log("═".repeat(60));
  console.log("Warehouse Staff Access Repair Script");
  console.log("═".repeat(60));
  console.log();

  try {
    const results = await repairWarehouseStaffAccess(dryRun);

    console.log();
    console.log("═".repeat(60));
    console.log("Summary");
    console.log("═".repeat(60));

    const repaired = results.filter((r) => r.branchMemberCreated || r.accessPermissionCreated);
    const errors = results.filter((r) => r.errors.length > 0);

    console.log(`Total checked: ${results.length}`);
    console.log(`Repaired: ${repaired.length}`);
    console.log(`Errors: ${errors.length}`);

    if (errors.length > 0) {
      console.log();
      console.log("Errors encountered:");
      errors.forEach((e) => {
        console.log(`  - User ${e.userId}: ${e.errors.join(", ")}`);
      });
    }

    if (dryRun) {
      console.log();
      console.log("⚠️  This was a DRY RUN. No changes were made.");
      console.log("   Run without --dry-run to apply fixes.");
    } else {
      console.log();
      console.log("✅ Repairs applied successfully!");
    }

    console.log();
    console.log("Next steps:");
    console.log("  1. Test login for repaired users");
    console.log("  2. Monitor for any issues");
    console.log("  3. Run verification script if needed");
  } catch (err: any) {
    console.error("Fatal error:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
