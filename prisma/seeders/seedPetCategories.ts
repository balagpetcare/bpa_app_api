import { PrismaClient } from "@prisma/client";

/**
 * Seeder for pet-related categories and subcategories
 * Creates a comprehensive category tree for pet products
 */
export default async function seedPetCategories(prisma: PrismaClient) {
  console.log("🌱 Seeding Pet Categories and Subcategories...");

  // Category structure: { name, slug, children: [...] }
  const categoryStructure = [
    {
      name: "Food",
      slug: "food",
      children: [
        { name: "Dry Food", slug: "dry-food" },
        { name: "Wet Food", slug: "wet-food" },
        { name: "Puppy Food", slug: "puppy-food" },
        { name: "Kitten Food", slug: "kitten-food" },
        { name: "Senior Food", slug: "senior-food" },
        { name: "Grain-Free Food", slug: "grain-free-food" },
        { name: "Raw Food", slug: "raw-food" },
        { name: "Freeze-Dried Food", slug: "freeze-dried-food" },
        { name: "Dehydrated Food", slug: "dehydrated-food" },
      ],
    },
    {
      name: "Treats",
      slug: "treats",
      children: [
        { name: "Training Treats", slug: "training-treats" },
        { name: "Dental Treats", slug: "dental-treats" },
        { name: "Chew Treats", slug: "chew-treats" },
        { name: "Soft Treats", slug: "soft-treats" },
        { name: "Biscuits", slug: "biscuits" },
        { name: "Jerky", slug: "jerky" },
        { name: "Freeze-Dried Treats", slug: "freeze-dried-treats" },
      ],
    },
    {
      name: "Toys",
      slug: "toys",
      children: [
        { name: "Interactive Toys", slug: "interactive-toys" },
        { name: "Chew Toys", slug: "chew-toys" },
        { name: "Plush Toys", slug: "plush-toys" },
        { name: "Rope Toys", slug: "rope-toys" },
        { name: "Ball Toys", slug: "ball-toys" },
        { name: "Frisbees", slug: "frisbees" },
        { name: "Puzzle Toys", slug: "puzzle-toys" },
        { name: "Fetch Toys", slug: "fetch-toys" },
        { name: "Catnip Toys", slug: "catnip-toys" },
        { name: "Feather Toys", slug: "feather-toys" },
      ],
    },
    {
      name: "Accessories",
      slug: "accessories",
      children: [
        { name: "Collars", slug: "collars" },
        { name: "Leashes", slug: "leashes" },
        { name: "Harnesses", slug: "harnesses" },
        { name: "ID Tags", slug: "id-tags" },
        { name: "Bowls & Feeders", slug: "bowls-feeders" },
        { name: "Water Fountains", slug: "water-fountains" },
        { name: "Carriers", slug: "carriers" },
        { name: "Crates", slug: "crates" },
        { name: "Gates", slug: "gates" },
        { name: "Pet Clothing", slug: "pet-clothing" },
      ],
    },
    {
      name: "Health & Care",
      slug: "health-care",
      children: [
        { name: "Flea & Tick Control", slug: "flea-tick-control" },
        { name: "Deworming", slug: "deworming" },
        { name: "Vitamins & Supplements", slug: "vitamins-supplements" },
        { name: "Dental Care", slug: "dental-care" },
        { name: "Ear Care", slug: "ear-care" },
        { name: "Eye Care", slug: "eye-care" },
        { name: "Skin & Coat Care", slug: "skin-coat-care" },
        { name: "First Aid", slug: "first-aid" },
        { name: "Medications", slug: "medications" },
        { name: "Health Monitors", slug: "health-monitors" },
      ],
    },
    {
      name: "Grooming",
      slug: "grooming",
      children: [
        { name: "Shampoos & Conditioners", slug: "shampoos-conditioners" },
        { name: "Brushes & Combs", slug: "brushes-combs" },
        { name: "Nail Clippers", slug: "nail-clippers" },
        { name: "Grooming Tools", slug: "grooming-tools" },
        { name: "Wipes & Sprays", slug: "wipes-sprays" },
        { name: "Deodorizers", slug: "deodorizers" },
        { name: "Grooming Kits", slug: "grooming-kits" },
      ],
    },
    {
      name: "Bedding & Furniture",
      slug: "bedding-furniture",
      children: [
        { name: "Beds", slug: "beds" },
        { name: "Blankets", slug: "blankets" },
        { name: "Cushions", slug: "cushions" },
        { name: "Cat Trees", slug: "cat-trees" },
        { name: "Scratching Posts", slug: "scratching-posts" },
        { name: "Pet Houses", slug: "pet-houses" },
        { name: "Hammocks", slug: "hammocks" },
      ],
    },
    {
      name: "Training",
      slug: "training",
      children: [
        { name: "Training Pads", slug: "training-pads" },
        { name: "Clickers", slug: "clickers" },
        { name: "Training Treats", slug: "training-treats" },
        { name: "Agility Equipment", slug: "agility-equipment" },
        { name: "Behavior Aids", slug: "behavior-aids" },
      ],
    },
    {
      name: "Travel",
      slug: "travel",
      children: [
        { name: "Carriers", slug: "carriers" },
        { name: "Travel Bowls", slug: "travel-bowls" },
        { name: "Travel Beds", slug: "travel-beds" },
        { name: "Seat Covers", slug: "seat-covers" },
        { name: "Travel Accessories", slug: "travel-accessories" },
      ],
    },
    {
      name: "Litter & Waste",
      slug: "litter-waste",
      children: [
        { name: "Cat Litter", slug: "cat-litter" },
        { name: "Litter Boxes", slug: "litter-boxes" },
        { name: "Litter Scoops", slug: "litter-scoops" },
        { name: "Waste Bags", slug: "waste-bags" },
        { name: "Poop Scoopers", slug: "poop-scoopers" },
      ],
    },
  ];

  let createdCategories = 0;
  let createdSubcategories = 0;
  let skippedCategories = 0;
  let skippedSubcategories = 0;

  for (const category of categoryStructure) {
    // Create or get parent category
    let parentCategory = await prisma.category.findFirst({
      where: { slug: category.slug, parentId: null },
    });

    if (!parentCategory) {
      parentCategory = await prisma.category.create({
        data: {
          name: category.name,
          slug: category.slug,
          parentId: null,
          sortOrder: 0,
        },
      });
      createdCategories++;
      console.log(`  ✓ Created category: ${category.name}`);
    } else {
      skippedCategories++;
      console.log(`  - Category already exists: ${category.name}`);
    }

    // Create subcategories
    if (parentCategory && category.children) {
      for (const subcat of category.children) {
        const existing = await prisma.category.findFirst({
          where: {
            slug: subcat.slug,
            parentId: parentCategory.id,
          },
        });

        if (!existing) {
          await prisma.category.create({
            data: {
              name: subcat.name,
              slug: subcat.slug,
              parentId: parentCategory.id,
              sortOrder: 0,
            },
          });
          createdSubcategories++;
          console.log(`    ✓ Created subcategory: ${subcat.name}`);
        } else {
          skippedSubcategories++;
          console.log(`    - Subcategory already exists: ${subcat.name}`);
        }
      }
    }
  }

  console.log(
    `✅ Pet Categories seeding completed! Categories: ${createdCategories} created, ${skippedCategories} skipped. Subcategories: ${createdSubcategories} created, ${skippedSubcategories} skipped.`
  );
}
