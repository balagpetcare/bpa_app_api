import { PrismaClient } from "@prisma/client";

/**
 * Seeder for Master Product Catalog
 * Populates global catalog with popular pet food products from worldwide brands
 */
export default async function seedMasterProductCatalog(prisma: PrismaClient) {
  console.log("🌱 Seeding Master Product Catalog...");

  // Get existing brands, categories, units, and flavors
  const brands = await prisma.brand.findMany();
  const categories = await prisma.category.findMany();
  const units = await prisma.unit.findMany();
  const flavors = await prisma.flavor.findMany();

  // Create lookup maps
  const brandMap: Record<string, number> = {};
  brands.forEach((b) => {
    brandMap[b.name.toLowerCase()] = b.id;
  });

  const categoryMap: Record<string, number> = {};
  categories.forEach((c) => {
    categoryMap[c.slug.toLowerCase()] = c.id;
  });

  const unitMap: Record<string, number> = {};
  units.forEach((u) => {
    unitMap[u.code.toLowerCase()] = u.id;
  });

  const flavorMap: Record<string, number> = {};
  flavors.forEach((f) => {
    flavorMap[f.name.toLowerCase()] = f.id;
  });

  // Helper function to generate slug
  const slugify = (text: string) => {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  };

  // Master product catalog data
  const masterProducts = [
    // Royal Canin Products
    {
      name: "Royal Canin Adult Dog Food",
      brand: "Royal Canin",
      category: "dry-food",
      description:
        "Complete nutrition for adult dogs. Formulated with optimal protein levels and essential nutrients for healthy growth and maintenance.",
      variants: [
        { title: "1kg", unit: "KG", flavor: "Chicken", suggestedPrice: 1200 },
        { title: "3kg", unit: "KG", flavor: "Chicken", suggestedPrice: 3200 },
        { title: "15kg", unit: "KG", flavor: "Chicken", suggestedPrice: 14500 },
      ],
      suggestedPrice: 1200,
      metaJson: {
        ingredients: ["Chicken meal", "Rice", "Wheat", "Animal fat", "Beet pulp"],
        nutritionalInfo: { protein: "21%", fat: "13%", fiber: "3.5%" },
        lifeStage: "Adult",
        animalType: "Dog",
      },
    },
    {
      name: "Royal Canin Puppy Food",
      brand: "Royal Canin",
      category: "puppy-food",
      description:
        "Specialized nutrition for puppies up to 12 months. Supports healthy growth and development.",
      variants: [
        { title: "1kg", unit: "KG", flavor: "Chicken", suggestedPrice: 1300 },
        { title: "3kg", unit: "KG", flavor: "Chicken", suggestedPrice: 3500 },
      ],
      suggestedPrice: 1300,
      metaJson: {
        ingredients: ["Chicken meal", "Rice", "Corn", "Animal fat"],
        nutritionalInfo: { protein: "28%", fat: "15%", fiber: "3%" },
        lifeStage: "Puppy",
        animalType: "Dog",
      },
    },
    {
      name: "Royal Canin Adult Cat Food",
      brand: "Royal Canin",
      category: "dry-food",
      description: "Complete nutrition for adult cats. Supports urinary health and digestive balance.",
      variants: [
        { title: "1kg", unit: "KG", flavor: "Chicken", suggestedPrice: 1100 },
        { title: "4kg", unit: "KG", flavor: "Chicken", suggestedPrice: 4000 },
        { title: "10kg", unit: "KG", flavor: "Chicken", suggestedPrice: 9500 },
      ],
      suggestedPrice: 1100,
      metaJson: {
        ingredients: ["Chicken meal", "Rice", "Corn gluten meal", "Animal fat"],
        nutritionalInfo: { protein: "31%", fat: "11%", fiber: "3.5%" },
        lifeStage: "Adult",
        animalType: "Cat",
      },
    },
    {
      name: "Royal Canin Kitten Food",
      brand: "Royal Canin",
      category: "kitten-food",
      description: "Nutritional support for kittens up to 12 months. Promotes healthy growth.",
      variants: [
        { title: "1kg", unit: "KG", flavor: "Chicken", suggestedPrice: 1200 },
        { title: "4kg", unit: "KG", flavor: "Chicken", suggestedPrice: 4200 },
      ],
      suggestedPrice: 1200,
      metaJson: {
        ingredients: ["Chicken meal", "Rice", "Corn", "Animal fat"],
        nutritionalInfo: { protein: "34%", fat: "16%", fiber: "3%" },
        lifeStage: "Kitten",
        animalType: "Cat",
      },
    },

    // Pedigree Products
    {
      name: "Pedigree Adult Dog Food",
      brand: "Pedigree",
      category: "dry-food",
      description:
        "Complete and balanced nutrition for adult dogs. Made with real meat and vegetables.",
      variants: [
        { title: "1.2kg", unit: "KG", flavor: "Chicken", suggestedPrice: 450 },
        { title: "3kg", unit: "KG", flavor: "Chicken", suggestedPrice: 1100 },
        { title: "14kg", unit: "KG", flavor: "Chicken", suggestedPrice: 4800 },
        { title: "1.2kg", unit: "KG", flavor: "Beef", suggestedPrice: 450 },
        { title: "3kg", unit: "KG", flavor: "Beef", suggestedPrice: 1100 },
      ],
      suggestedPrice: 450,
      metaJson: {
        ingredients: ["Chicken", "Rice", "Wheat", "Corn", "Animal fat"],
        nutritionalInfo: { protein: "21%", fat: "10%", fiber: "4%" },
        lifeStage: "Adult",
        animalType: "Dog",
      },
    },
    {
      name: "Pedigree Puppy Food",
      brand: "Pedigree",
      category: "puppy-food",
      description: "Nutrition for growing puppies. Supports healthy bone and muscle development.",
      variants: [
        { title: "1.2kg", unit: "KG", flavor: "Chicken", suggestedPrice: 480 },
        { title: "3kg", unit: "KG", flavor: "Chicken", suggestedPrice: 1150 },
      ],
      suggestedPrice: 480,
      metaJson: {
        ingredients: ["Chicken", "Rice", "Wheat", "Corn", "Animal fat"],
        nutritionalInfo: { protein: "26%", fat: "12%", fiber: "3.5%" },
        lifeStage: "Puppy",
        animalType: "Dog",
      },
    },
    {
      name: "Pedigree Dentastix",
      brand: "Pedigree",
      category: "dental-treats",
      description: "Daily dental chews that help reduce tartar buildup by up to 80%.",
      variants: [
        { title: "7 pieces", unit: "PCS", flavor: "Original", suggestedPrice: 180 },
        { title: "28 pieces", unit: "PCS", flavor: "Original", suggestedPrice: 650 },
      ],
      suggestedPrice: 180,
      metaJson: {
        ingredients: ["Wheat starch", "Glycerin", "Gelatin", "Chicken"],
        nutritionalInfo: { protein: "15%", fat: "2%", fiber: "5%" },
        lifeStage: "All",
        animalType: "Dog",
      },
    },

    // Whiskas Products
    {
      name: "Whiskas Adult Cat Food",
      brand: "Whiskas",
      category: "dry-food",
      description: "Complete nutrition for adult cats. Made with real meat and fish.",
      variants: [
        { title: "1.1kg", unit: "KG", flavor: "Chicken", suggestedPrice: 380 },
        { title: "3.5kg", unit: "KG", flavor: "Chicken", suggestedPrice: 1200 },
        { title: "1.1kg", unit: "KG", flavor: "Fish", suggestedPrice: 380 },
        { title: "3.5kg", unit: "KG", flavor: "Fish", suggestedPrice: 1200 },
      ],
      suggestedPrice: 380,
      metaJson: {
        ingredients: ["Chicken meal", "Rice", "Corn", "Animal fat", "Fish meal"],
        nutritionalInfo: { protein: "30%", fat: "10%", fiber: "4%" },
        lifeStage: "Adult",
        animalType: "Cat",
      },
    },
    {
      name: "Whiskas Kitten Food",
      brand: "Whiskas",
      category: "kitten-food",
      description: "Special nutrition for kittens. Supports healthy growth and development.",
      variants: [
        { title: "1.1kg", unit: "KG", flavor: "Chicken", suggestedPrice: 400 },
        { title: "3.5kg", unit: "KG", flavor: "Chicken", suggestedPrice: 1250 },
      ],
      suggestedPrice: 400,
      metaJson: {
        ingredients: ["Chicken meal", "Rice", "Corn", "Animal fat"],
        nutritionalInfo: { protein: "33%", fat: "12%", fiber: "3.5%" },
        lifeStage: "Kitten",
        animalType: "Cat",
      },
    },
    {
      name: "Whiskas Wet Cat Food",
      brand: "Whiskas",
      category: "wet-food",
      description: "Delicious wet food for cats. Available in various flavors.",
      variants: [
        { title: "400g", unit: "G", flavor: "Chicken", suggestedPrice: 120 },
        { title: "400g", unit: "G", flavor: "Fish", suggestedPrice: 120 },
        { title: "400g", unit: "G", flavor: "Tuna", suggestedPrice: 120 },
      ],
      suggestedPrice: 120,
      metaJson: {
        ingredients: ["Chicken", "Water", "Rice", "Wheat gluten"],
        nutritionalInfo: { protein: "12%", fat: "3%", fiber: "1%" },
        lifeStage: "Adult",
        animalType: "Cat",
      },
    },

    // Purina Products
    {
      name: "Purina Pro Plan Adult Dog Food",
      brand: "Purina",
      category: "dry-food",
      description:
        "Advanced nutrition for adult dogs. Formulated with real chicken as the first ingredient.",
      variants: [
        { title: "1kg", unit: "KG", flavor: "Chicken", suggestedPrice: 950 },
        { title: "3kg", unit: "KG", flavor: "Chicken", suggestedPrice: 2700 },
        { title: "14kg", unit: "KG", flavor: "Chicken", suggestedPrice: 12000 },
      ],
      suggestedPrice: 950,
      metaJson: {
        ingredients: ["Chicken", "Rice", "Corn gluten meal", "Animal fat"],
        nutritionalInfo: { protein: "26%", fat: "16%", fiber: "4%" },
        lifeStage: "Adult",
        animalType: "Dog",
      },
    },
    {
      name: "Purina Pro Plan Puppy Food",
      brand: "Purina",
      category: "puppy-food",
      description: "Complete nutrition for puppies. Supports healthy brain and vision development.",
      variants: [
        { title: "1kg", unit: "KG", flavor: "Chicken", suggestedPrice: 1000 },
        { title: "3kg", unit: "KG", flavor: "Chicken", suggestedPrice: 2800 },
      ],
      suggestedPrice: 1000,
      metaJson: {
        ingredients: ["Chicken", "Rice", "Corn", "Animal fat"],
        nutritionalInfo: { protein: "28%", fat: "18%", fiber: "3.5%" },
        lifeStage: "Puppy",
        animalType: "Dog",
      },
    },
    {
      name: "Purina Fancy Feast Cat Food",
      brand: "Purina",
      category: "wet-food",
      description: "Gourmet wet food for cats. Made with real meat and fish.",
      variants: [
        { title: "85g", unit: "G", flavor: "Chicken", suggestedPrice: 45 },
        { title: "85g", unit: "G", flavor: "Tuna", suggestedPrice: 45 },
        { title: "85g", unit: "G", flavor: "Salmon", suggestedPrice: 45 },
      ],
      suggestedPrice: 45,
      metaJson: {
        ingredients: ["Chicken", "Water", "Rice", "Wheat gluten"],
        nutritionalInfo: { protein: "11%", fat: "2.5%", fiber: "1%" },
        lifeStage: "Adult",
        animalType: "Cat",
      },
    },

    // Hills Science Diet Products
    {
      name: "Hills Science Diet Adult Dog Food",
      brand: "Hills Science Diet",
      category: "dry-food",
      description:
        "Veterinarian recommended nutrition. Made with natural ingredients and clinically proven antioxidants.",
      variants: [
        { title: "1.5kg", unit: "KG", flavor: "Chicken", suggestedPrice: 1800 },
        { title: "5kg", unit: "KG", flavor: "Chicken", suggestedPrice: 5500 },
        { title: "15kg", unit: "KG", flavor: "Chicken", suggestedPrice: 16000 },
      ],
      suggestedPrice: 1800,
      metaJson: {
        ingredients: ["Chicken meal", "Brewers rice", "Whole grain wheat", "Animal fat"],
        nutritionalInfo: { protein: "21%", fat: "13%", fiber: "3.5%" },
        lifeStage: "Adult",
        animalType: "Dog",
      },
    },
    {
      name: "Hills Science Diet Adult Cat Food",
      brand: "Hills Science Diet",
      category: "dry-food",
      description: "Veterinarian recommended nutrition for adult cats.",
      variants: [
        { title: "1.5kg", unit: "KG", flavor: "Chicken", suggestedPrice: 1700 },
        { title: "5kg", unit: "KG", flavor: "Chicken", suggestedPrice: 5200 },
      ],
      suggestedPrice: 1700,
      metaJson: {
        ingredients: ["Chicken meal", "Brewers rice", "Corn gluten meal", "Animal fat"],
        nutritionalInfo: { protein: "31%", fat: "19%", fiber: "4%" },
        lifeStage: "Adult",
        animalType: "Cat",
      },
    },

    // Eukanuba Products
    {
      name: "Eukanuba Adult Dog Food",
      brand: "Eukanuba",
      category: "dry-food",
      description: "Premium nutrition for adult dogs. Made with real chicken.",
      variants: [
        { title: "1kg", unit: "KG", flavor: "Chicken", suggestedPrice: 1100 },
        { title: "3kg", unit: "KG", flavor: "Chicken", suggestedPrice: 3000 },
        { title: "15kg", unit: "KG", flavor: "Chicken", suggestedPrice: 14000 },
      ],
      suggestedPrice: 1100,
      metaJson: {
        ingredients: ["Chicken", "Corn", "Wheat", "Animal fat"],
        nutritionalInfo: { protein: "24%", fat: "14%", fiber: "4%" },
        lifeStage: "Adult",
        animalType: "Dog",
      },
    },

    // Iams Products
    {
      name: "Iams Proactive Health Adult Dog Food",
      brand: "Iams Proactive Health",
      category: "dry-food",
      description: "Complete nutrition for adult dogs. Supports healthy digestion.",
      variants: [
        { title: "1.5kg", unit: "KG", flavor: "Chicken", suggestedPrice: 850 },
        { title: "7kg", unit: "KG", flavor: "Chicken", suggestedPrice: 3800 },
      ],
      suggestedPrice: 850,
      metaJson: {
        ingredients: ["Chicken", "Corn", "Wheat", "Animal fat"],
        nutritionalInfo: { protein: "23%", fat: "14%", fiber: "4%" },
        lifeStage: "Adult",
        animalType: "Dog",
      },
    },

    // Treats
    {
      name: "Pedigree Schmackos",
      brand: "Pedigree",
      category: "training-treats",
      description: "Soft and chewy training treats for dogs.",
      variants: [
        { title: "100g", unit: "G", flavor: "Chicken", suggestedPrice: 120 },
        { title: "200g", unit: "G", flavor: "Chicken", suggestedPrice: 220 },
      ],
      suggestedPrice: 120,
      metaJson: {
        ingredients: ["Wheat flour", "Chicken", "Glycerin", "Sugar"],
        nutritionalInfo: { protein: "12%", fat: "5%", fiber: "2%" },
        lifeStage: "All",
        animalType: "Dog",
      },
    },
    {
      name: "Whiskas Temptations Cat Treats",
      brand: "Whiskas",
      category: "training-treats",
      description: "Irresistible treats for cats. Available in various flavors.",
      variants: [
        { title: "60g", unit: "G", flavor: "Chicken", suggestedPrice: 150 },
        { title: "60g", unit: "G", flavor: "Tuna", suggestedPrice: 150 },
      ],
      suggestedPrice: 150,
      metaJson: {
        ingredients: ["Chicken", "Wheat flour", "Corn starch", "Glycerin"],
        nutritionalInfo: { protein: "30%", fat: "13%", fiber: "3%" },
        lifeStage: "All",
        animalType: "Cat",
      },
    },
  ];

  let createdCount = 0;
  let skippedCount = 0;

  for (const productData of masterProducts) {
    try {
      const brandId = brandMap[productData.brand.toLowerCase()];
      const categoryId = categoryMap[productData.category.toLowerCase()];

      if (!brandId) {
        console.log(`  ⚠ Brand not found: ${productData.brand}, skipping product: ${productData.name}`);
        skippedCount++;
        continue;
      }

      if (!categoryId) {
        console.log(`  ⚠ Category not found: ${productData.category}, skipping product: ${productData.name}`);
        skippedCount++;
        continue;
      }

      const slug = slugify(productData.name);

      // Check if product already exists
      const existing = await prisma.masterProductCatalog.findUnique({
        where: { slug },
      });

      if (existing) {
        skippedCount++;
        console.log(`  - Product already exists: ${productData.name}`);
        continue;
      }

      // Process variants JSON
      const variantsJson = productData.variants.map((v) => {
        const unitId = unitMap[v.unit.toLowerCase()];
        const flavorId = v.flavor ? flavorMap[v.flavor.toLowerCase()] : null;
        return {
          title: v.title,
          unit: v.unit,
          unitId: unitId || null,
          flavor: v.flavor,
          flavorId: flavorId || null,
          suggestedPrice: v.suggestedPrice || productData.suggestedPrice,
        };
      });

      // Create master product
      await prisma.masterProductCatalog.create({
        data: {
          name: productData.name,
          slug: slug,
          brandId: brandId,
          categoryId: categoryId,
          description: productData.description,
          variantsJson: variantsJson as any,
          suggestedPrice: productData.suggestedPrice,
          currency: "BDT",
          metaJson: productData.metaJson as any,
          isActive: true,
          isVerified: true, // Seed data is pre-verified
          sourceType: "SEED",
        },
      });

      createdCount++;
      console.log(`  ✓ Created: ${productData.name}`);
    } catch (error: any) {
      console.error(`  ✗ Error creating product ${productData.name}:`, error?.message);
      skippedCount++;
    }
  }

  console.log(
    `✅ Master Product Catalog seeding completed! Created: ${createdCount}, Skipped: ${skippedCount}`
  );
}
