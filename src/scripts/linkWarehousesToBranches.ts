/**
 * Link Warehouses to Branches Script
 *
 * This script ensures every warehouse has a valid branchId by:
 * 1. Finding all warehouses without a branchId
 * 2. For each warehouse, either finding an existing WAREHOUSE_DC branch or creating one
 * 3. Updating the warehouse with the branchId
 *
 * Usage:
 *   npx ts-node src/scripts/linkWarehousesToBranches.ts [--dry-run]
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, BranchStatus, VerificationStatus } from "@prisma/client";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set");
}

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const BRANCH_TYPE_WAREHOUSE_DC = "WAREHOUSE_DC";

interface LinkResult {
  warehouseId: number;
  warehouseName: string;
  orgId: number;
  action: "linked" | "created" | "skipped" | "error";
  branchId?: number;
  branchName?: string;
  error?: string;
}

async function getOrCreateWarehouseBranch(
  warehouse: { id: number; name: string; orgId: number; code: string | null },
  dryRun: boolean
): Promise<{ branchId: number; branchName: string; action: "linked" | "created" }> {
  // First, try to find an existing WAREHOUSE_DC branch in the same org with similar name
  const existingBranches = await prisma.branch.findMany({
    where: {
      orgId: warehouse.orgId,
      types: {
        some: {
          type: {
            code: BRANCH_TYPE_WAREHOUSE_DC,
          },
        },
      },
    },
    include: {
      types: {
        include: {
          type: true,
        },
      },
    },
  });

  // Look for a branch with matching name (case-insensitive)
  const matchingBranch = existingBranches.find(
    (b) => b.name.toLowerCase() === warehouse.name.toLowerCase()
  );

  if (matchingBranch) {
    return {
      branchId: matchingBranch.id,
      branchName: matchingBranch.name,
      action: "linked",
    };
  }

  // If no matching branch, create a new one
  if (dryRun) {
    return {
      branchId: -1, // placeholder
      branchName: `${warehouse.name} (Branch)`,
      action: "created",
    };
  }

  // Get WAREHOUSE_DC branch type
  const warehouseDcType = await prisma.branchType.findUnique({
    where: { code: BRANCH_TYPE_WAREHOUSE_DC },
  });

  if (!warehouseDcType) {
    throw new Error(`BranchType ${BRANCH_TYPE_WAREHOUSE_DC} not found`);
  }

  // Create new branch for the warehouse
  const newBranch = await prisma.branch.create({
    data: {
      orgId: warehouse.orgId,
      name: warehouse.name,
      code: warehouse.code || `WH-${warehouse.id}`,
      status: BranchStatus.ACTIVE,
      verificationStatus: VerificationStatus.VERIFIED,
      types: {
        create: {
          typeId: warehouseDcType.id,
        },
      },
      capabilitiesJson: JSON.stringify({ warehouse: true }),
      featuresJson: JSON.stringify({
        inventory: true,
        purchaseOrders: true,
        warehouseManagement: true,
      }),
    },
  });

  return {
    branchId: newBranch.id,
    branchName: newBranch.name,
    action: "created",
  };
}

async function linkWarehousesToBranches(dryRun: boolean = false): Promise<LinkResult[]> {
  const results: LinkResult[] = [];

  // Find all warehouses without a branchId
  const warehousesWithoutBranch = await prisma.warehouse.findMany({
    where: {
      branchId: null,
    },
    select: {
      id: true,
      name: true,
      orgId: true,
      code: true,
    },
  });

  console.log(`Found ${warehousesWithoutBranch.length} warehouses without branchId`);

  for (const warehouse of warehousesWithoutBranch) {
    try {
      const result = await getOrCreateWarehouseBranch(warehouse, dryRun);

      if (!dryRun && result.branchId > 0) {
        // Update warehouse with the branchId
        await prisma.warehouse.update({
          where: { id: warehouse.id },
          data: { branchId: result.branchId },
        });
      }

      results.push({
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        orgId: warehouse.orgId,
        action: result.action,
        branchId: result.branchId,
        branchName: result.branchName,
      });

      console.log(
        `${dryRun ? "[DRY RUN] " : ""}Warehouse ${warehouse.id} (${warehouse.name}): ${result.action} to branch ${result.branchId} (${result.branchName})`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.push({
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        orgId: warehouse.orgId,
        action: "error",
        error: errorMessage,
      });
      console.error(`Error processing warehouse ${warehouse.id}:`, errorMessage);
    }
  }

  return results;
}

async function printSummary(results: LinkResult[]) {
  const linked = results.filter((r) => r.action === "linked").length;
  const created = results.filter((r) => r.action === "created").length;
  const errors = results.filter((r) => r.action === "error").length;

  console.log("\n=== Summary ===");
  console.log(`Total warehouses processed: ${results.length}`);
  console.log(`  - Linked to existing branches: ${linked}`);
  console.log(`  - Created new branches: ${created}`);
  console.log(`  - Errors: ${errors}`);

  if (errors > 0) {
    console.log("\nErrors encountered:");
    results
      .filter((r) => r.action === "error")
      .forEach((r) => {
        console.log(`  - Warehouse ${r.warehouseId}: ${r.error}`);
      });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  console.log(`Starting warehouse-to-branch linkage${dryRun ? " (DRY RUN)" : ""}...`);

  try {
    const results = await linkWarehousesToBranches(dryRun);
    await printSummary(results);

    if (dryRun) {
      console.log("\nThis was a dry run. No changes were made.");
      console.log("Run without --dry-run to apply changes.");
    } else {
      console.log("\nAll changes have been applied.");
    }
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
