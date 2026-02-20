import { PrismaClient } from "@prisma/client";

export default async function seedProductsMasterData(prisma: PrismaClient) {
  console.log("🌱 Seeding Products Master Data...");

  // 1. Categories (tree structure)
  const categories = [
    { name: "Food", slug: "food", parentId: null },
    { name: "Treats", slug: "treats", parentId: null },
    { name: "Toys", slug: "toys", parentId: null },
    { name: "Accessories", slug: "accessories", parentId: null },
    { name: "Health & Care", slug: "health-care", parentId: null },
    { name: "Dry Food", slug: "dry-food", parentId: null }, // child of Food
    { name: "Wet Food", slug: "wet-food", parentId: null }, // child of Food
  ];

  const categoryMap: Record<string, number> = {};

  for (const cat of categories) {
    let parentId = null;
    if (cat.slug === "dry-food" || cat.slug === "wet-food") {
      // Find Food category
      const foodCat = await prisma.category.findFirst({
        where: { slug: "food", parentId: null },
      });
      if (foodCat) parentId = foodCat.id;
    }

    const existing = await prisma.category.findFirst({
      where: { slug: cat.slug, parentId },
    });

    if (!existing) {
      const created = await prisma.category.create({
        data: {
          name: cat.name,
          slug: cat.slug,
          parentId,
          sortOrder: 0,
        },
      });
      categoryMap[cat.slug] = created.id;
      console.log(`  ✓ Created category: ${cat.name}`);
    } else {
      categoryMap[cat.slug] = existing.id;
      console.log(`  - Category already exists: ${cat.name}`);
    }
  }

  // 2. Units
  const units = [
    { code: "KG", name: "Kilogram" },
    { code: "G", name: "Gram" },
    { code: "L", name: "Liter" },
    { code: "ML", name: "Milliliter" },
    { code: "PCS", name: "Pieces" },
    { code: "BOX", name: "Box" },
    { code: "PACK", name: "Pack" },
  ];

  for (const unit of units) {
    const existing = await prisma.unit.findUnique({
      where: { code: unit.code },
    });

    if (!existing) {
      await prisma.unit.create({
        data: unit,
      });
      console.log(`  ✓ Created unit: ${unit.code} (${unit.name})`);
    } else {
      console.log(`  - Unit already exists: ${unit.code}`);
    }
  }

  // 3. Flavors
  const flavors = [
    "Chicken",
    "Fish",
    "Beef",
    "Lamb",
    "Duck",
    "Turkey",
    "Salmon",
    "Tuna",
    "Mixed",
    "Vegetarian",
  ];

  for (const flavorName of flavors) {
    const existing = await prisma.flavor.findFirst({
      where: { name: flavorName },
    });

    if (!existing) {
      await prisma.flavor.create({
        data: { name: flavorName },
      });
      console.log(`  ✓ Created flavor: ${flavorName}`);
    } else {
      console.log(`  - Flavor already exists: ${flavorName}`);
    }
  }

  // 4. Brands (optional - can be added later)
  console.log("  ℹ Brands can be added later via admin/owner panel");

  console.log("✅ Products Master Data seeding completed!");
}
