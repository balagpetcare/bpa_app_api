import { PrismaClient } from "@prisma/client";

/**
 * Seeder: ~200 demo products in Master Product Catalog
 * Uses existing brands and categories. Run after seedPetBrands, seedPetCategories, seedMasterProductCatalog.
 */
export default async function seedDemoMasterProductCatalog(prisma: PrismaClient) {
  console.log("🌱 Seeding Demo Master Product Catalog (~200 products)...");

  const brands = await prisma.brand.findMany();
  const categories = await prisma.category.findMany();

  const brandMap: Record<string, number> = {};
  brands.forEach((b) => {
    brandMap[b.name.toLowerCase()] = b.id;
  });

  const categoryMap: Record<string, number> = {};
  categories.forEach((c) => {
    categoryMap[c.slug.toLowerCase()] = c.id;
  });

  const slugify = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  // 20 brands to rotate (must exist in DB)
  const brandNames = [
    "Royal Canin",
    "Pedigree",
    "Whiskas",
    "Purina",
    "Hills Science Diet",
    "Eukanuba",
    "Iams Proactive Health",
    "Acana",
    "Orijen",
    "Wellness",
    "Blue Buffalo",
    "Taste of the Wild",
    "Kong",
    "Nylabone",
    "Frontline",
    "Advantage",
    "Wahl",
    "Furminator",
    "K&H Pet Products",
    "Petmate",
  ];

  // 10 product type templates → 20 × 10 = 200 products
  const productTypes: Array<{
    namePart: string;
    categorySlug: string;
    description: string;
    basePrice: number;
    variantTitles: string[];
  }> = [
    {
      namePart: "Adult Dog Dry Food",
      categorySlug: "dry-food",
      description: "Complete nutrition for adult dogs. Balanced protein and essential nutrients.",
      basePrice: 950,
      variantTitles: ["1kg", "3kg", "7kg"],
    },
    {
      namePart: "Puppy Dry Food",
      categorySlug: "puppy-food",
      description: "Growth formula for puppies. Supports healthy development.",
      basePrice: 1100,
      variantTitles: ["1kg", "3kg", "5kg"],
    },
    {
      namePart: "Adult Cat Dry Food",
      categorySlug: "dry-food",
      description: "Complete nutrition for adult cats. Supports urinary and digestive health.",
      basePrice: 900,
      variantTitles: ["1kg", "2kg", "4kg"],
    },
    {
      namePart: "Kitten Dry Food",
      categorySlug: "kitten-food",
      description: "Specialized nutrition for kittens. Promotes healthy growth.",
      basePrice: 1000,
      variantTitles: ["1kg", "2kg", "4kg"],
    },
    {
      namePart: "Senior Dog Food",
      categorySlug: "senior-food",
      description: "Mature adult formula. Easy digestion and joint support.",
      basePrice: 1200,
      variantTitles: ["1.5kg", "4kg", "8kg"],
    },
    {
      namePart: "Dog Training Treats",
      categorySlug: "training-treats",
      description: "Soft training treats. Ideal for reward-based training.",
      basePrice: 180,
      variantTitles: ["100g", "250g", "500g"],
    },
    {
      namePart: "Cat Treats",
      categorySlug: "training-treats",
      description: "Irresistible treats for cats. Multiple flavors.",
      basePrice: 150,
      variantTitles: ["50g", "120g", "200g"],
    },
    {
      namePart: "Wet Food Pouches",
      categorySlug: "wet-food",
      description: "Wet food in convenient pouches. High moisture content.",
      basePrice: 45,
      variantTitles: ["85g pouch", "400g pack", "12×85g multipack"],
    },
    {
      namePart: "Dental Chews",
      categorySlug: "dental-treats",
      description: "Daily dental chews. Helps reduce tartar buildup.",
      basePrice: 220,
      variantTitles: ["7 pieces", "28 pieces", "56 pieces"],
    },
    {
      namePart: "Grain-Free Adult Dog Food",
      categorySlug: "grain-free-food",
      description: "Grain-free formula for dogs with sensitivities.",
      basePrice: 1400,
      variantTitles: ["1kg", "4kg", "10kg"],
    },
  ];

  let createdCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < 200; i++) {
    const brandName = brandNames[i % brandNames.length];
    const typeIndex = Math.floor(i / brandNames.length) % productTypes.length;
    const productType = productTypes[typeIndex];

    const name = `${brandName} ${productType.namePart}`;
    const slug = slugify(name);

    const brandId = brandMap[brandName.toLowerCase()];
    const categoryId = categoryMap[productType.categorySlug];

    if (!brandId) {
      skippedCount++;
      continue;
    }
    if (!categoryId) {
      skippedCount++;
      continue;
    }

    const existing = await prisma.masterProductCatalog.findUnique({
      where: { slug },
    });
    if (existing) {
      skippedCount++;
      continue;
    }

    const variants = productType.variantTitles.map((title, idx) => ({
      title,
      unit: title.includes("g") ? "G" : title.includes("kg") ? "KG" : "PCS",
      flavor: "Chicken",
      suggestedPrice: productType.basePrice * (1 + idx * 0.4) + (i % 50),
    }));

    const variantsJson = variants.map((v) => ({
      title: v.title,
      unit: v.unit,
      flavor: v.flavor,
      suggestedPrice: v.suggestedPrice,
    }));

    try {
      await prisma.masterProductCatalog.create({
        data: {
          name,
          slug,
          brandId,
          categoryId,
          description: productType.description,
          variantsJson: variantsJson as any,
          suggestedPrice: productType.basePrice,
          currency: "BDT",
          metaJson: {
            lifeStage: productType.namePart.includes("Puppy") || productType.namePart.includes("Kitten") ? "Junior" : "Adult",
            animalType: productType.namePart.includes("Cat") || productType.namePart.includes("Kitten") ? "Cat" : "Dog",
            sourceType: "DEMO",
          } as any,
          isActive: true,
          isVerified: false,
          sourceType: "SEED",
          sourceRef: "seedDemoMasterProductCatalog",
        },
      });
      createdCount++;
      if (createdCount <= 5 || createdCount % 50 === 0) {
        console.log(`  ✓ Created: ${name}`);
      }
    } catch (err: any) {
      console.error(`  ✗ Error creating ${name}:`, err?.message);
      skippedCount++;
    }
  }

  console.log(
    `✅ Demo Master Product Catalog done. Created: ${createdCount}, Skipped: ${skippedCount}`
  );
}
