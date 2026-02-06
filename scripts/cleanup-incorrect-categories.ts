/**
 * Cleanup script to remove incorrectly created categories
 * These are categories that were created from product names instead of using existing categories
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Valid categories from seed data (these should be kept)
const VALID_CATEGORY_SLUGS = [
  // Main categories
  "food",
  "treats",
  "toys",
  "accessories",
  "health-care",
  "grooming",
  "bedding-furniture",
  "training",
  "travel",
  "litter-waste",
  // Subcategories
  "dry-food",
  "wet-food",
  "puppy-food",
  "kitten-food",
  "senior-food",
  "grain-free-food",
  "raw-food",
  "freeze-dried-food",
  "dehydrated-food",
  "training-treats",
  "dental-treats",
  "chew-treats",
  "soft-treats",
  "biscuits",
  "jerky",
  "freeze-dried-treats",
  "interactive-toys",
  "chew-toys",
  "plush-toys",
  "rope-toys",
  "ball-toys",
  "frisbees",
  "puzzle-toys",
  "fetch-toys",
  "catnip-toys",
  "feather-toys",
  "collars",
  "leashes",
  "harnesses",
  "id-tags",
  "bowls-feeders",
  "water-fountains",
  "carriers",
  "crates",
  "gates",
  "pet-clothing",
  "flea-tick-control",
  "deworming",
  "vitamins-supplements",
  "dental-care",
  "ear-care",
  "eye-care",
  "skin-coat-care",
  "first-aid",
  "medications",
  "health-monitors",
  "shampoos-conditioners",
  "brushes-combs",
  "nail-clippers",
  "grooming-tools",
  "wipes-sprays",
  "deodorizers",
  "grooming-kits",
  "beds",
  "blankets",
  "cushions",
  "cat-trees",
  "scratching-posts",
  "pet-houses",
  "hammocks",
  "training-pads",
  "clickers",
  "agility-equipment",
  "behavior-aids",
  "travel-bowls",
  "travel-beds",
  "seat-covers",
  "travel-accessories",
  "cat-litter",
  "litter-boxes",
  "litter-scoops",
  "waste-bags",
  "poop-scoopers",
];

async function cleanupIncorrectCategories() {
  console.log("🧹 Starting cleanup of incorrectly created categories...\n");

  // Get all categories with counts
  const allCategories = await prisma.category.findMany({
    include: {
      _count: {
        select: {
          products: true,
          masterProducts: true,
        },
      },
    },
    orderBy: {
      name: "asc",
    },
  });

  console.log(`Found ${allCategories.length} total categories\n`);

  // Identify categories to delete
  const categoriesToDelete: Array<{
    id: number;
    name: string;
    slug: string;
    productCount: number;
    masterProductCount: number;
  }> = [];

  for (const category of allCategories) {
    const isValid = VALID_CATEGORY_SLUGS.includes(category.slug.toLowerCase());
    const productCount = category._count.products;
    const masterProductCount = category._count.masterProducts;

    // Delete ALL categories that are NOT in valid category list
    // Even if they have products/master products (categoryId will be set to null)
    if (!isValid) {
      categoriesToDelete.push({
        id: category.id,
        name: category.name,
        slug: category.slug,
        productCount: productCount,
        masterProductCount: masterProductCount,
      });
    }
  }

  if (categoriesToDelete.length === 0) {
    console.log("✅ No incorrect categories found to delete!\n");
    return;
  }

  console.log(`Found ${categoriesToDelete.length} categories to delete:\n`);
  categoriesToDelete.forEach((cat) => {
    const usageInfo = [];
    if (cat.productCount > 0) usageInfo.push(`${cat.productCount} products`);
    if (cat.masterProductCount > 0) usageInfo.push(`${cat.masterProductCount} master products`);
    const usageText = usageInfo.length > 0 ? ` [${usageInfo.join(", ")}]` : "";
    console.log(`  - ${cat.name} (slug: ${cat.slug}, ID: ${cat.id})${usageText}`);
  });

  console.log("\n⚠️  WARNING: This will permanently delete these categories!");
  console.log("Products and master products using these categories will have categoryId set to NULL.");
  console.log("Press Ctrl+C to cancel, or wait 5 seconds to proceed...\n");

  // Wait 5 seconds
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Delete categories
  // Note: Delete child categories (subcategories) first, then parent categories
  // Prisma's onDelete: SetNull will automatically set categoryId to NULL in related tables
  let deletedCount = 0;
  let errorCount = 0;

  // Get parent-child relationships
  const categoryMap = new Map(allCategories.map((c) => [c.id, c]));
  
  // Separate child categories (have parentId) and parent categories
  const childCategoriesToDelete = categoriesToDelete.filter((cat) => {
    const category = categoryMap.get(cat.id);
    return category?.parentId != null;
  });

  const parentCategoriesToDelete = categoriesToDelete.filter((cat) => {
    const category = categoryMap.get(cat.id);
    return category?.parentId == null;
  });

  // Delete order: children first, then parents
  const categoriesToProcess = [...childCategoriesToDelete, ...parentCategoriesToDelete];

  // Track deleted IDs to avoid double deletion
  const deletedIds = new Set<number>();

  for (const cat of categoriesToProcess) {
    // Skip if already deleted
    if (deletedIds.has(cat.id)) {
      continue;
    }

    try {
      // Delete the category itself
      // Prisma's onDelete: SetNull will automatically set categoryId to NULL in Product and MasterProductCatalog tables
      await prisma.category.delete({
        where: { id: cat.id },
      });
      deletedIds.add(cat.id);
      deletedCount++;
      const usageInfo = [];
      if (cat.productCount > 0) usageInfo.push(`${cat.productCount} products`);
      if (cat.masterProductCount > 0) usageInfo.push(`${cat.masterProductCount} master products`);
      const usageText = usageInfo.length > 0 ? ` (${usageInfo.join(", ")} will have categoryId set to NULL)` : "";
      console.log(`  ✓ Deleted category: ${cat.name}${usageText}`);
    } catch (error: any) {
      // If it's a foreign key constraint, use raw SQL to force delete
      if (error?.code === "P2003" || error?.message?.includes("Foreign key constraint")) {
        try {
          console.log(`    Attempting force delete with raw SQL for ${cat.name}...`);
          // First set foreign keys to null, then delete
          await prisma.$executeRawUnsafe(`
            UPDATE products SET "categoryId" = NULL WHERE "categoryId" = ${cat.id};
            UPDATE master_product_catalog SET "categoryId" = NULL WHERE "categoryId" = ${cat.id};
            DELETE FROM categories WHERE id = ${cat.id};
          `);
          deletedIds.add(cat.id);
          deletedCount++;
          const usageInfo = [];
          if (cat.productCount > 0) usageInfo.push(`${cat.productCount} products`);
          if (cat.masterProductCount > 0) usageInfo.push(`${cat.masterProductCount} master products`);
          const usageText = usageInfo.length > 0 ? ` (${usageInfo.join(", ")} had categoryId set to NULL)` : "";
          console.log(`    ✓ Force deleted category: ${cat.name}${usageText}`);
        } catch (sqlError: any) {
          errorCount++;
          console.error(`    ✗ Force delete failed for ${cat.name}:`, sqlError?.message);
        }
      } else if (error?.code === "P2025") {
        // Record not found - might have been deleted already
        deletedIds.add(cat.id);
        console.log(`  - Category ${cat.name} already deleted or not found`);
      } else {
        errorCount++;
        console.error(`  ✗ Error deleting category ${cat.name}:`, error?.message);
      }
    }
  }

  console.log(`\n✅ Cleanup completed! Deleted: ${deletedCount}, Errors: ${errorCount}`);
}

cleanupIncorrectCategories()
  .catch((e) => {
    console.error("❌ Cleanup failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
