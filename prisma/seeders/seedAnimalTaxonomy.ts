import { PrismaClient, Prisma } from "@prisma/client";

/** Canonical breed name for local/native/indigenous animals; required for every animal type. */
export const LOCAL_INDIGENOUS_BREED_NAME = "Local / Indigenous";

/** Alias names for search/display; avoids duplicate rows for Local, Deshi, Native, Indigenous. */
export const LOCAL_INDIGENOUS_ALIAS_NAMES: string[] = ["Local", "Indigenous", "Deshi", "Native"];

/**
 * Enterprise animal taxonomy seed: categories → types → breeds → sub-breeds;
 * standalone: colors, coat patterns, sizes.
 * Single source of truth for GET /api/v1/common/* taxonomy endpoints.
 * Uses type assertion so this file compiles when Prisma client may not yet include taxonomy models; run `npx prisma generate` after schema changes.
 */
export default async function seedAnimalTaxonomy(prisma: PrismaClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;
  console.log("Seeding enterprise animal taxonomy...");

  // 1) Animal categories
  const categories: { code: string; name: string; displayOrder: number }[] = [
    { code: "mammal", name: "Mammal", displayOrder: 1 },
    { code: "bird", name: "Bird", displayOrder: 2 },
    { code: "reptile", name: "Reptile", displayOrder: 3 },
    { code: "fish", name: "Fish", displayOrder: 4 },
    { code: "amphibian", name: "Amphibian", displayOrder: 5 },
    { code: "exotic", name: "Exotic", displayOrder: 6 },
    { code: "other", name: "Other", displayOrder: 7 },
  ];
  for (const c of categories) {
    await db.animalCategory.upsert({
      where: { code: c.code },
      update: { name: c.name, displayOrder: c.displayOrder },
      create: { code: c.code, name: c.name, displayOrder: c.displayOrder },
    });
  }
  const mammalCat = await db.animalCategory.findUnique({ where: { code: "mammal" } });
  const birdCat = await db.animalCategory.findUnique({ where: { code: "bird" } });
  const reptileCat = await db.animalCategory.findUnique({ where: { code: "reptile" } });
  const fishCat = await db.animalCategory.findUnique({ where: { code: "fish" } });
  const otherCat = await db.animalCategory.findUnique({ where: { code: "other" } });

  // 2) Animal sizes
  const sizes: { code: string; name: string; minKg?: number; maxKg?: number; order: number }[] = [
    { code: "extra_small", name: "Extra Small", maxKg: 2.5, order: 1 },
    { code: "toy", name: "Toy", minKg: 2.5, maxKg: 5, order: 2 },
    { code: "small", name: "Small", minKg: 5, maxKg: 12, order: 3 },
    { code: "medium", name: "Medium", minKg: 12, maxKg: 25, order: 4 },
    { code: "large", name: "Large", minKg: 25, maxKg: 45, order: 5 },
    { code: "giant", name: "Giant", minKg: 45, order: 6 },
  ];
  const sizeIds: Record<string, number> = {};
  for (const s of sizes) {
    const row = await db.animalSize.upsert({
      where: { code: s.code },
      update: { name: s.name, minWeightKg: s.minKg ?? null, maxWeightKg: s.maxKg ?? null, displayOrder: s.order },
      create: { code: s.code, name: s.name, minWeightKg: s.minKg ?? null, maxWeightKg: s.maxKg ?? null, displayOrder: s.order },
    });
    sizeIds[s.code] = row.id;
  }

  // 3) Animal colors
  const colors: { code: string; name: string; hex?: string; order: number }[] = [
    { code: "black", name: "Black", hex: "#1a1a1a", order: 1 },
    { code: "white", name: "White", hex: "#f5f5f5", order: 2 },
    { code: "brown", name: "Brown", hex: "#8B4513", order: 3 },
    { code: "golden", name: "Golden", hex: "#DAA520", order: 4 },
    { code: "grey", name: "Grey", hex: "#808080", order: 5 },
    { code: "cream", name: "Cream", hex: "#FFFDD0", order: 6 },
    { code: "orange", name: "Orange", hex: "#FF8C00", order: 7 },
    { code: "red", name: "Red", hex: "#CD5C5C", order: 8 },
    { code: "fawn", name: "Fawn", hex: "#E5AA70", order: 9 },
    { code: "blue", name: "Blue", hex: "#4682B4", order: 10 },
    { code: "silver", name: "Silver", hex: "#C0C0C0", order: 11 },
    { code: "chocolate", name: "Chocolate", hex: "#D2691E", order: 12 },
    { code: "tan", name: "Tan", hex: "#D2B48C", order: 13 },
    { code: "yellow", name: "Yellow", hex: "#FFD700", order: 14 },
    { code: "buff", name: "Buff", hex: "#F0DC82", order: 15 },
    { code: "lavender", name: "Lavender", hex: "#E6E6FA", order: 16 },
    { code: "apricot", name: "Apricot", hex: "#FBCEB1", order: 17 },
    { code: "sable", name: "Sable", hex: "#6B4423", order: 18 },
    { code: "black_white", name: "Black & White", order: 19 },
    { code: "brown_white", name: "Brown & White", order: 20 },
    { code: "tricolor", name: "Tricolor", order: 21 },
    { code: "bicolor", name: "Bicolor", order: 22 },
    { code: "brindle", name: "Brindle", order: 23 },
    { code: "merle", name: "Merle", order: 24 },
    { code: "mixed", name: "Mixed", order: 25 },
  ];
  for (const c of colors) {
    await db.animalColor.upsert({
      where: { code: c.code },
      update: { name: c.name, hexPreview: c.hex ?? null, displayOrder: c.order },
      create: { code: c.code, name: c.name, hexPreview: c.hex ?? null, displayOrder: c.order },
    });
  }

  // 4) Coat patterns
  const coatPatterns: { code: string; name: string; order: number }[] = [
    { code: "solid", name: "Solid", order: 1 },
    { code: "tabby", name: "Tabby", order: 2 },
    { code: "calico", name: "Calico", order: 3 },
    { code: "brindle", name: "Brindle", order: 4 },
    { code: "spotted", name: "Spotted", order: 5 },
    { code: "bicolor", name: "Bicolor", order: 6 },
    { code: "tricolor", name: "Tricolor", order: 7 },
    { code: "striped", name: "Striped", order: 8 },
    { code: "merle", name: "Merle", order: 9 },
    { code: "tortoiseshell", name: "Tortoiseshell", order: 10 },
    { code: "harlequin", name: "Harlequin", order: 11 },
    { code: "mixed", name: "Mixed", order: 12 },
  ];
  for (const p of coatPatterns) {
    await db.coatPattern.upsert({
      where: { code: p.code },
      update: { name: p.name, displayOrder: p.order },
      create: { code: p.code, name: p.name, displayOrder: p.order },
    });
  }

  // 5) Animal types (with category)
  const typeRows: { name: string; code: string; categoryId: number | null; order: number }[] = [
    { name: "Dog", code: "dog", categoryId: mammalCat!.id, order: 1 },
    { name: "Cat", code: "cat", categoryId: mammalCat!.id, order: 2 },
    { name: "Rabbit", code: "rabbit", categoryId: mammalCat!.id, order: 3 },
    { name: "Guinea Pig", code: "guinea_pig", categoryId: mammalCat!.id, order: 4 },
    { name: "Hamster", code: "hamster", categoryId: mammalCat!.id, order: 5 },
    { name: "Parrot", code: "parrot", categoryId: birdCat!.id, order: 6 },
    { name: "Pigeon", code: "pigeon", categoryId: birdCat!.id, order: 7 },
    { name: "Budgerigar", code: "budgerigar", categoryId: birdCat!.id, order: 8 },
    { name: "Cow", code: "cow", categoryId: mammalCat!.id, order: 9 },
    { name: "Goat", code: "goat", categoryId: mammalCat!.id, order: 10 },
    { name: "Horse", code: "horse", categoryId: mammalCat!.id, order: 11 },
    { name: "Turtle", code: "turtle", categoryId: reptileCat!.id, order: 12 },
    { name: "Snake", code: "snake", categoryId: reptileCat!.id, order: 13 },
    { name: "Fish", code: "fish", categoryId: fishCat!.id, order: 14 },
    { name: "Other", code: "other", categoryId: otherCat!.id, order: 15 },
  ];
  const typeIds: Record<string, number> = {};
  for (const t of typeRows) {
    const row = await db.animalType.upsert({
      where: { name: t.name },
      update: { code: t.code, categoryId: t.categoryId, displayOrder: t.order, isActive: true },
      create: { name: t.name, code: t.code, categoryId: t.categoryId, displayOrder: t.order, isActive: true },
    });
    typeIds[t.code] = row.id;
  }

  // 6) Breeds by animal type
  const dogBreeds: { name: string; aliasNames?: string[]; defaultSize?: string; isMixed?: boolean; isOther?: boolean }[] = [
    { name: "Labrador Retriever", defaultSize: "large" },
    { name: "Golden Retriever", defaultSize: "large" },
    { name: "German Shepherd", defaultSize: "large" },
    { name: "Beagle", defaultSize: "medium" },
    { name: "Bulldog", defaultSize: "medium" },
    { name: "French Bulldog", defaultSize: "small" },
    { name: "Poodle", defaultSize: "medium" },
    { name: "Rottweiler", defaultSize: "large" },
    { name: "Yorkshire Terrier", defaultSize: "toy" },
    { name: "Boxer", defaultSize: "large" },
    { name: "Dachshund", defaultSize: "small" },
    { name: "Siberian Husky", defaultSize: "large" },
    { name: "Doberman Pinscher", defaultSize: "large" },
    { name: "Chihuahua", defaultSize: "toy" },
    { name: "Pomeranian", defaultSize: "toy" },
    { name: "Shih Tzu", defaultSize: "small" },
    { name: "Cocker Spaniel", defaultSize: "medium" },
    { name: "Maltese", defaultSize: "toy" },
    { name: "Pug", defaultSize: "small" },
    { name: "Dalmatian", defaultSize: "large" },
    { name: "Australian Shepherd", defaultSize: "medium" },
    { name: "Border Collie", defaultSize: "medium" },
    { name: "Corgi", defaultSize: "small" },
    { name: "Jack Russell Terrier", defaultSize: "small" },
    { name: "Lhasa Apso", defaultSize: "small" },
    { name: "Pekingese", defaultSize: "small" },
    { name: "Spitz", defaultSize: "small" },
    { name: "St. Bernard", defaultSize: "giant" },
    { name: "Great Dane", defaultSize: "giant" },
    { name: "Mastiff", defaultSize: "giant" },
    { name: "Akita", defaultSize: "large" },
    { name: "Alaskan Malamute", defaultSize: "large" },
    { name: "Basset Hound", defaultSize: "medium" },
    { name: "Boston Terrier", defaultSize: "small" },
    { name: "Bull Terrier", defaultSize: "medium" },
    { name: "Cane Corso", defaultSize: "large" },
    { name: "Cavalier King Charles Spaniel", defaultSize: "small" },
    { name: "Collie", defaultSize: "large" },
    { name: "English Springer Spaniel", defaultSize: "medium" },
    { name: "German Shorthaired Pointer", defaultSize: "large" },
    { name: "Greyhound", defaultSize: "large" },
    { name: "Havanese", defaultSize: "small" },
    { name: "Irish Setter", defaultSize: "large" },
    { name: "Italian Greyhound", defaultSize: "small" },
    { name: "Miniature Schnauzer", defaultSize: "small" },
    { name: "Papillon", defaultSize: "toy" },
    { name: "Pit Bull Terrier", defaultSize: "medium" },
    { name: "Samoyed", defaultSize: "medium" },
    { name: "Shetland Sheepdog", defaultSize: "small" },
    { name: "Staffordshire Bull Terrier", defaultSize: "medium" },
    { name: "Weimaraner", defaultSize: "large" },
    { name: "West Highland White Terrier", defaultSize: "small" },
    { name: "Whippet", defaultSize: "medium" },
    { name: LOCAL_INDIGENOUS_BREED_NAME, aliasNames: [...LOCAL_INDIGENOUS_ALIAS_NAMES, "Local Dog"], defaultSize: "medium" },
    { name: "Mixed", isMixed: true, defaultSize: "medium" },
    { name: "Other", isOther: true },
  ];
  const catBreeds: { name: string; defaultSize?: string; isMixed?: boolean; isOther?: boolean }[] = [
    { name: "Siamese", defaultSize: "medium" },
    { name: "Persian", defaultSize: "medium" },
    { name: "Maine Coon", defaultSize: "large" },
    { name: "Ragdoll", defaultSize: "large" },
    { name: "British Shorthair", defaultSize: "medium" },
    { name: "Bengal", defaultSize: "medium" },
    { name: "Abyssinian", defaultSize: "medium" },
    { name: "Sphynx", defaultSize: "medium" },
    { name: "Scottish Fold", defaultSize: "medium" },
    { name: "Russian Blue", defaultSize: "medium" },
    { name: "Birman", defaultSize: "medium" },
    { name: "Oriental", defaultSize: "medium" },
    { name: "Tonkinese", defaultSize: "medium" },
    { name: "Burmese", defaultSize: "medium" },
    { name: "Himalayan", defaultSize: "medium" },
    { name: "Manx", defaultSize: "medium" },
    { name: "American Shorthair", defaultSize: "medium" },
    { name: "Exotic Shorthair", defaultSize: "medium" },
    { name: "Devon Rex", defaultSize: "small" },
    { name: "Cornish Rex", defaultSize: "small" },
    { name: "Turkish Angora", defaultSize: "medium" },
    { name: "Norwegian Forest Cat", defaultSize: "large" },
    { name: "Savannah", defaultSize: "large" },
    { name: "Egyptian Mau", defaultSize: "medium" },
    { name: "Ocicat", defaultSize: "medium" },
    { name: "Chartreux", defaultSize: "medium" },
    { name: "Bombay", defaultSize: "medium" },
    { name: "Somali", defaultSize: "medium" },
    { name: "Mixed", isMixed: true, defaultSize: "medium" },
    { name: "Other", isOther: true },
  ];
  const rabbitBreeds: { name: string }[] = [
    "Dutch", "Lop", "Rex", "Mini Lop", "Lionhead", "Angora", "Flemish Giant", "Dwarf", "Himalayan", "New Zealand", "Mixed", "Other",
  ].map((n) => ({ name: n }));
  const parrotBreeds: { name: string }[] = [
    "Cockatiel", "Budgerigar", "African Grey", "Macaw", "Lovebird", "Conure", "Cockatoo", "Parakeet", "Canary", "Finch", "Mixed", "Other",
  ].map((n) => ({ name: n }));
  const pigeonBreeds: { name: string }[] = ["Racing", "Fantail", "Mixed", "Other"].map((n) => ({ name: n }));
  const budgerigarBreeds: { name: string }[] = ["English", "American", "Mixed", "Other"].map((n) => ({ name: n }));
  const otherTypeBreeds = [{ name: "Mixed" }, { name: "Other" }];

  const dogId = typeIds.dog;
  const catId = typeIds.cat;
  const rabbitId = typeIds.rabbit;
  const parrotId = typeIds.parrot;
  const pigeonId = typeIds.pigeon;
  const budgerigarId = typeIds.budgerigar;
  const otherId = typeIds.other;

  for (const b of dogBreeds) {
    await db.breed.upsert({
      where: { name_animalTypeId: { name: b.name, animalTypeId: dogId } },
      update: {
        aliasNames: b.aliasNames ? (b.aliasNames as Prisma.InputJsonValue) : undefined,
        defaultSizeId: b.defaultSize ? sizeIds[b.defaultSize] : null,
        isMixed: b.isMixed ?? false,
        isOther: b.isOther ?? false,
        displayOrder: 0,
        isActive: true,
      },
      create: {
        name: b.name,
        animalTypeId: dogId,
        aliasNames: b.aliasNames ? (b.aliasNames as Prisma.InputJsonValue) : null,
        defaultSizeId: b.defaultSize ? sizeIds[b.defaultSize] : null,
        isMixed: b.isMixed ?? false,
        isOther: b.isOther ?? false,
        displayOrder: 0,
        isActive: true,
      },
    });
  }
  for (const b of catBreeds) {
    await db.breed.upsert({
      where: { name_animalTypeId: { name: b.name, animalTypeId: catId } },
      update: {
        defaultSizeId: b.defaultSize ? sizeIds[b.defaultSize] : null,
        isMixed: b.isMixed ?? false,
        isOther: b.isOther ?? false,
        displayOrder: 0,
        isActive: true,
      },
      create: {
        name: b.name,
        animalTypeId: catId,
        defaultSizeId: b.defaultSize ? sizeIds[b.defaultSize] : null,
        isMixed: b.isMixed ?? false,
        isOther: b.isOther ?? false,
        displayOrder: 0,
        isActive: true,
      },
    });
  }
  for (const b of rabbitBreeds) {
    await db.breed.upsert({
      where: { name_animalTypeId: { name: b.name, animalTypeId: rabbitId } },
      update: {},
      create: { name: b.name, animalTypeId: rabbitId },
    });
  }
  for (const b of parrotBreeds) {
    await db.breed.upsert({
      where: { name_animalTypeId: { name: b.name, animalTypeId: parrotId } },
      update: {},
      create: { name: b.name, animalTypeId: parrotId },
    });
  }
  for (const b of pigeonBreeds) {
    await db.breed.upsert({
      where: { name_animalTypeId: { name: b.name, animalTypeId: pigeonId } },
      update: {},
      create: { name: b.name, animalTypeId: pigeonId },
    });
  }
  for (const b of budgerigarBreeds) {
    await db.breed.upsert({
      where: { name_animalTypeId: { name: b.name, animalTypeId: budgerigarId } },
      update: {},
      create: { name: b.name, animalTypeId: budgerigarId },
    });
  }
  for (const b of otherTypeBreeds) {
    await db.breed.upsert({
      where: { name_animalTypeId: { name: b.name, animalTypeId: otherId } },
      update: {},
      create: { name: b.name, animalTypeId: otherId },
    });
  }

  // 6.1) Ensure "Local / Indigenous" breed exists for every animal type (mandatory)
  const allTypes = await db.animalType.findMany({ select: { id: true, name: true } });
  const aliasJson = LOCAL_INDIGENOUS_ALIAS_NAMES as Prisma.InputJsonValue;
  for (const at of allTypes) {
    const existing = await db.breed.findUnique({
      where: { name_animalTypeId: { name: LOCAL_INDIGENOUS_BREED_NAME, animalTypeId: at.id } },
    });
    if (existing) {
      await db.breed.update({
        where: { id: existing.id },
        data: { aliasNames: aliasJson, isActive: true },
      });
      continue;
    }
    const legacyNames = ["Local / Deshi", "Local", "Indigenous", "Native", "Deshi"];
    const legacy = await db.breed.findFirst({
      where: { animalTypeId: at.id, name: { in: legacyNames } },
    });
    if (legacy) {
      await db.breed.update({
        where: { id: legacy.id },
        data: { name: LOCAL_INDIGENOUS_BREED_NAME, aliasNames: aliasJson, isActive: true },
      });
      continue;
    }
    await db.breed.create({
      data: {
        name: LOCAL_INDIGENOUS_BREED_NAME,
        animalTypeId: at.id,
        aliasNames: aliasJson,
        displayOrder: 0,
        isActive: true,
      },
    });
  }

  // 7) Sub-breeds (for breeds that have varieties)
  const gsBreed = await db.breed.findUnique({ where: { name_animalTypeId: { name: "German Shepherd", animalTypeId: dogId } } });
  const persianBreed = await db.breed.findUnique({ where: { name_animalTypeId: { name: "Persian", animalTypeId: catId } } });
  const lopBreed = await db.breed.findUnique({ where: { name_animalTypeId: { name: "Lop", animalTypeId: rabbitId } } });

  if (gsBreed) {
    for (const sub of [{ code: "working_line", name: "Working Line" }, { code: "show_line", name: "Show Line" }]) {
      await db.subBreed.upsert({
        where: { breedId_code: { breedId: gsBreed.id, code: sub.code } },
        update: { name: sub.name },
        create: { breedId: gsBreed.id, code: sub.code, name: sub.name },
      });
    }
  }
  if (persianBreed) {
    for (const sub of [{ code: "doll_face", name: "Doll Face" }, { code: "peke_face", name: "Peke Face" }]) {
      await db.subBreed.upsert({
        where: { breedId_code: { breedId: persianBreed.id, code: sub.code } },
        update: { name: sub.name },
        create: { breedId: persianBreed.id, code: sub.code, name: sub.name },
      });
    }
  }
  // Budgerigar (breed under Parrot type) has sub-breeds English / American
  const budgieBreedUnderParrot = await db.breed.findFirst({ where: { name: "Budgerigar", animalTypeId: parrotId } });
  if (budgieBreedUnderParrot) {
    for (const sub of [{ code: "english", name: "English" }, { code: "american", name: "American" }]) {
      await db.subBreed.upsert({
        where: { breedId_code: { breedId: budgieBreedUnderParrot.id, code: sub.code } },
        update: { name: sub.name },
        create: { breedId: budgieBreedUnderParrot.id, code: sub.code, name: sub.name },
      });
    }
  }
  if (lopBreed) {
    for (const sub of [{ code: "mini_lop", name: "Mini Lop" }, { code: "standard", name: "Standard" }]) {
      await db.subBreed.upsert({
        where: { breedId_code: { breedId: lopBreed.id, code: sub.code } },
        update: { name: sub.name },
        create: { breedId: lopBreed.id, code: sub.code, name: sub.name },
      });
    }
  }

  console.log("Enterprise animal taxonomy seeded.");
}

/**
 * Ensures the mandatory "Local / Indigenous" breed exists for the given animal type.
 * Call this when creating a new animal type (e.g. admin create-animal-type flow) so the type
 * always has this default breed option.
 */
export async function ensureLocalIndigenousBreedForType(
  prisma: PrismaClient,
  animalTypeId: number
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;
  const aliasJson = LOCAL_INDIGENOUS_ALIAS_NAMES as Prisma.InputJsonValue;
  const existing = await db.breed.findUnique({
    where: { name_animalTypeId: { name: LOCAL_INDIGENOUS_BREED_NAME, animalTypeId } },
  });
  if (existing) {
    await db.breed.update({
      where: { id: existing.id },
      data: { aliasNames: aliasJson, isActive: true },
    });
    return;
  }
  const legacyNames = ["Local / Deshi", "Local", "Indigenous", "Native", "Deshi"];
  const legacy = await db.breed.findFirst({
    where: { animalTypeId, name: { in: legacyNames } },
  });
  if (legacy) {
    await db.breed.update({
      where: { id: legacy.id },
      data: { name: LOCAL_INDIGENOUS_BREED_NAME, aliasNames: aliasJson, isActive: true },
    });
    return;
  }
  await db.breed.create({
    data: {
      name: LOCAL_INDIGENOUS_BREED_NAME,
      animalTypeId,
      aliasNames: aliasJson,
      displayOrder: 0,
      isActive: true,
    },
  });
}
