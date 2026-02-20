import { PrismaClient } from "@prisma/client";

/**
 * Seeder for pet-related brands (companies)
 * This includes popular pet food, toy, and care product brands
 */
export default async function seedPetBrands(prisma: PrismaClient) {
  console.log("🌱 Seeding Pet Brands...");

  // Pet food brands
  const petFoodBrands = [
    "Royal Canin",
    "Pedigree",
    "Whiskas",
    "Purina",
    "Hills Science Diet",
    "Eukanuba",
    "Iams",
    "Acana",
    "Orijen",
    "Wellness",
    "Blue Buffalo",
    "Taste of the Wild",
    "Diamond Pet Foods",
    "Nutro",
    "Merrick",
    "Fromm",
    "Canidae",
    "Natural Balance",
    "Zignature",
    "Farmina",
    "Pro Plan",
    "Friskies",
    "Fancy Feast",
    "Sheba",
    "Meow Mix",
    "9Lives",
    "Iams Proactive Health",
    "Purina ONE",
    "Beneful",
    "Alpo",
  ];

  // Pet toy and accessory brands
  const petToyBrands = [
    "Kong",
    "Nylabone",
    "Chuckit",
    "Outward Hound",
    "JW Pet",
    "ZippyPaws",
    "Tuffy",
    "West Paw",
    "Planet Dog",
    "GoughNuts",
    "Benebone",
    "Hyper Pet",
    "PetSafe",
    "Frisco",
    "GoDog",
  ];

  // Pet care and health brands
  const petCareBrands = [
    "Frontline",
    "Advantage",
    "Seresto",
    "Hartz",
    "Adams",
    "Bayer",
    "Virbac",
    "Zoetis",
    "Merck Animal Health",
    "Elanco",
    "Bayer Animal Health",
    "Vetmedin",
    "Apoquel",
    "Cytopoint",
    "Bravecto",
    "NexGard",
    "Simparica",
    "Revolution",
    "Heartgard",
    "Interceptor",
  ];

  // Pet grooming brands
  const petGroomingBrands = [
    "Wahl",
    "Andis",
    "Furminator",
    "Chris Christensen",
    "Earthbath",
    "Burt's Bees",
    "TropiClean",
    "John Paul Pet",
    "Isle of Dogs",
    "Bio-Groom",
  ];

  // Pet bedding and furniture brands
  const petBeddingBrands = [
    "K&H Pet Products",
    "MidWest Homes for Pets",
    "Furhaven",
    "PetFusion",
    "BarksBar",
    "Petmate",
    "Aspen Pet",
    "Prevue Pet Products",
  ];

  // All brands combined
  const allBrands = [
    ...petFoodBrands,
    ...petToyBrands,
    ...petCareBrands,
    ...petGroomingBrands,
    ...petBeddingBrands,
  ];

  let createdCount = 0;
  let skippedCount = 0;

  for (const brandName of allBrands) {
    // Generate slug from name
    const slug = brandName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    try {
      const existing = await prisma.brand.findUnique({
        where: { slug },
      });

      if (!existing) {
        await prisma.brand.create({
          data: {
            name: brandName,
            slug,
          },
        });
        createdCount++;
        console.log(`  ✓ Created brand: ${brandName}`);
      } else {
        skippedCount++;
        console.log(`  - Brand already exists: ${brandName}`);
      }
    } catch (error: any) {
      console.error(`  ✗ Error creating brand ${brandName}:`, error?.message);
    }
  }

  console.log(
    `✅ Pet Brands seeding completed! Created: ${createdCount}, Skipped: ${skippedCount}`
  );
}
