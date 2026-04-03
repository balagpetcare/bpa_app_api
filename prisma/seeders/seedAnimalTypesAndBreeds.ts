import { PrismaClient } from "@prisma/client";

/**
 * Seeds animal_types and breeds for pet/patient registration.
 * Ensures GET /api/v1/common/animal-types and /breeds/:typeId return data.
 */
export default async function seedAnimalTypesAndBreeds(prisma: PrismaClient) {
  console.log("Seeding animal types and breeds...");

  const dog = await prisma.animalType.upsert({
    where: { name: "Dog" },
    update: {},
    create: { name: "Dog" },
  });
  const cat = await prisma.animalType.upsert({
    where: { name: "Cat" },
    update: {},
    create: { name: "Cat" },
  });

  const dogBreeds = [
    "Labrador Retriever", "Golden Retriever", "German Shepherd", "Beagle", "Bulldog",
    "French Bulldog", "Poodle", "Rottweiler", "Yorkshire Terrier", "Boxer",
    "Dachshund", "Siberian Husky", "Doberman Pinscher", "Chihuahua", "Pomeranian",
    "Shih Tzu", "Local / Indigenous", "Mixed", "Other",
  ];
  const catBreeds = [
    "Siamese", "Persian", "Maine Coon", "Ragdoll", "British Shorthair",
    "Bengal", "Abyssinian", "Sphynx", "Scottish Fold", "Russian Blue",
    "Local / Indigenous", "Mixed", "Other",
  ];

  for (const name of dogBreeds) {
    await prisma.breed.upsert({
      where: { name_animalTypeId: { name, animalTypeId: dog.id } },
      update: {},
      create: { name, animalTypeId: dog.id },
    });
  }
  for (const name of catBreeds) {
    await prisma.breed.upsert({
      where: { name_animalTypeId: { name, animalTypeId: cat.id } },
      update: {},
      create: { name, animalTypeId: cat.id },
    });
  }

  console.log("Animal types and breeds seeded.");
}
