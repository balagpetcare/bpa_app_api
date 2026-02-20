import { PrismaClient } from "@prisma/client";

/**
 * Seeder for Product Subcategories
 * Adds comprehensive subcategories to existing parent categories
 * This seeder works with categories that already exist in the database
 */
export default async function seedProductSubcategories(prisma: PrismaClient) {
  console.log("🌱 Seeding Product Subcategories...");

  // Subcategory mapping: parent category slug -> array of subcategories
  const subcategoryMap: Record<string, Array<{ name: string; slug: string }>> = {
    // Food subcategories
    food: [
      { name: "Dry Food", slug: "dry-food" },
      { name: "Wet Food", slug: "wet-food" },
      { name: "Puppy Food", slug: "puppy-food" },
      { name: "Kitten Food", slug: "kitten-food" },
      { name: "Senior Food", slug: "senior-food" },
      { name: "Adult Food", slug: "adult-food" },
      { name: "Grain-Free Food", slug: "grain-free-food" },
      { name: "Raw Food", slug: "raw-food" },
      { name: "Freeze-Dried Food", slug: "freeze-dried-food" },
      { name: "Dehydrated Food", slug: "dehydrated-food" },
      { name: "Prescription Diet", slug: "prescription-diet" },
      { name: "Weight Management", slug: "weight-management" },
      { name: "Sensitive Stomach", slug: "sensitive-stomach" },
      { name: "Allergy Formula", slug: "allergy-formula" },
    ],

    // Treats subcategories
    treats: [
      { name: "Training Treats", slug: "training-treats" },
      { name: "Dental Treats", slug: "dental-treats" },
      { name: "Chew Treats", slug: "chew-treats" },
      { name: "Soft Treats", slug: "soft-treats" },
      { name: "Hard Treats", slug: "hard-treats" },
      { name: "Biscuits", slug: "biscuits" },
      { name: "Jerky", slug: "jerky" },
      { name: "Freeze-Dried Treats", slug: "freeze-dried-treats" },
      { name: "Natural Treats", slug: "natural-treats" },
      { name: "Grain-Free Treats", slug: "grain-free-treats" },
      { name: "Puppy Treats", slug: "puppy-treats" },
      { name: "Senior Treats", slug: "senior-treats" },
    ],

    // Toys subcategories
    toys: [
      { name: "Interactive Toys", slug: "interactive-toys" },
      { name: "Chew Toys", slug: "chew-toys" },
      { name: "Plush Toys", slug: "plush-toys" },
      { name: "Rope Toys", slug: "rope-toys" },
      { name: "Ball Toys", slug: "ball-toys" },
      { name: "Frisbees", slug: "frisbees" },
      { name: "Puzzle Toys", slug: "puzzle-toys" },
      { name: "Fetch Toys", slug: "fetch-toys" },
      { name: "Tug Toys", slug: "tug-toys" },
      { name: "Catnip Toys", slug: "catnip-toys" },
      { name: "Feather Toys", slug: "feather-toys" },
      { name: "Laser Toys", slug: "laser-toys" },
      { name: "Electronic Toys", slug: "electronic-toys" },
      { name: "Squeaky Toys", slug: "squeaky-toys" },
      { name: "Durable Toys", slug: "durable-toys" },
    ],

    // Accessories subcategories
    accessories: [
      { name: "Collars", slug: "collars" },
      { name: "Leashes", slug: "leashes" },
      { name: "Harnesses", slug: "harnesses" },
      { name: "ID Tags", slug: "id-tags" },
      { name: "Bowls & Feeders", slug: "bowls-feeders" },
      { name: "Water Fountains", slug: "water-fountains" },
      { name: "Automatic Feeders", slug: "automatic-feeders" },
      { name: "Carriers", slug: "carriers" },
      { name: "Crates", slug: "crates" },
      { name: "Gates", slug: "gates" },
      { name: "Pet Clothing", slug: "pet-clothing" },
      { name: "Boots & Paw Protection", slug: "boots-paw-protection" },
      { name: "Muzzles", slug: "muzzles" },
      { name: "Reflective Gear", slug: "reflective-gear" },
    ],

    // Health & Care subcategories
    "health-care": [
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
      { name: "Probiotics", slug: "probiotics" },
      { name: "Joint Supplements", slug: "joint-supplements" },
      { name: "Calming Aids", slug: "calming-aids" },
      { name: "Wound Care", slug: "wound-care" },
    ],

    // Grooming subcategories
    grooming: [
      { name: "Shampoos & Conditioners", slug: "shampoos-conditioners" },
      { name: "Brushes & Combs", slug: "brushes-combs" },
      { name: "Nail Clippers", slug: "nail-clippers" },
      { name: "Grooming Tools", slug: "grooming-tools" },
      { name: "Wipes & Sprays", slug: "wipes-sprays" },
      { name: "Deodorizers", slug: "deodorizers" },
      { name: "Grooming Kits", slug: "grooming-kits" },
      { name: "Shedding Tools", slug: "shedding-tools" },
      { name: "Deshedding Brushes", slug: "deshedding-brushes" },
      { name: "Grooming Gloves", slug: "grooming-gloves" },
      { name: "Pet Wipes", slug: "pet-wipes" },
      { name: "Dry Shampoo", slug: "dry-shampoo" },
    ],

    // Bedding & Furniture subcategories
    "bedding-furniture": [
      { name: "Beds", slug: "beds" },
      { name: "Blankets", slug: "blankets" },
      { name: "Cushions", slug: "cushions" },
      { name: "Cat Trees", slug: "cat-trees" },
      { name: "Scratching Posts", slug: "scratching-posts" },
      { name: "Pet Houses", slug: "pet-houses" },
      { name: "Hammocks", slug: "hammocks" },
      { name: "Orthopedic Beds", slug: "orthopedic-beds" },
      { name: "Heated Beds", slug: "heated-beds" },
      { name: "Outdoor Beds", slug: "outdoor-beds" },
      { name: "Crate Pads", slug: "crate-pads" },
      { name: "Window Perches", slug: "window-perches" },
    ],

    // Training subcategories
    training: [
      { name: "Training Pads", slug: "training-pads" },
      { name: "Clickers", slug: "clickers" },
      { name: "Training Treats", slug: "training-treats" },
      { name: "Agility Equipment", slug: "agility-equipment" },
      { name: "Behavior Aids", slug: "behavior-aids" },
      { name: "Whistles", slug: "whistles" },
      { name: "Target Sticks", slug: "target-sticks" },
      { name: "Training Books", slug: "training-books" },
    ],

    // Travel subcategories
    travel: [
      { name: "Carriers", slug: "carriers" },
      { name: "Travel Bowls", slug: "travel-bowls" },
      { name: "Travel Beds", slug: "travel-beds" },
      { name: "Seat Covers", slug: "seat-covers" },
      { name: "Travel Accessories", slug: "travel-accessories" },
      { name: "Car Seats", slug: "car-seats" },
      { name: "Travel Crates", slug: "travel-crates" },
      { name: "Pet Passports", slug: "pet-passports" },
    ],

    // Litter & Waste subcategories
    "litter-waste": [
      { name: "Cat Litter", slug: "cat-litter" },
      { name: "Litter Boxes", slug: "litter-boxes" },
      { name: "Litter Scoops", slug: "litter-scoops" },
      { name: "Waste Bags", slug: "waste-bags" },
      { name: "Poop Scoopers", slug: "poop-scoopers" },
      { name: "Litter Liners", slug: "litter-liners" },
      { name: "Litter Deodorizers", slug: "litter-deodorizers" },
      { name: "Automatic Litter Boxes", slug: "automatic-litter-boxes" },
      { name: "Litter Mats", slug: "litter-mats" },
    ],
  };

  let totalCreated = 0;
  let totalSkipped = 0;
  let categoriesNotFound = 0;

  // Process each parent category
  for (const [parentSlug, subcategories] of Object.entries(subcategoryMap)) {
    // Find the parent category
    const parentCategory = await prisma.category.findFirst({
      where: {
        slug: parentSlug,
        parentId: null, // Only top-level categories
      },
    });

    if (!parentCategory) {
      categoriesNotFound++;
      console.log(`  ⚠ Parent category not found: ${parentSlug} (skipping subcategories)`);
      continue;
    }

    console.log(`  📁 Processing subcategories for: ${parentCategory.name}`);

    // Create subcategories for this parent
    for (const subcat of subcategories) {
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
        totalCreated++;
        console.log(`    ✓ Created subcategory: ${subcat.name}`);
      } else {
        totalSkipped++;
        console.log(`    - Subcategory already exists: ${subcat.name}`);
      }
    }
  }

  console.log(
    `✅ Product Subcategories seeding completed!`
  );
  console.log(
    `   Created: ${totalCreated} subcategories`
  );
  console.log(
    `   Skipped: ${totalSkipped} subcategories (already exist)`
  );
  if (categoriesNotFound > 0) {
    console.log(
      `   ⚠ Warning: ${categoriesNotFound} parent categories not found`
    );
  }
}
