const DEFAULT_VACCINE_TYPES = [
  {
    name: "Rabies",
    defaultIntervalDays: 365,
    description: "Core rabies vaccine.",
  },
  {
    name: "DHPP",
    defaultIntervalDays: 365,
    description: "Canine combination vaccine for distemper, hepatitis, parainfluenza, and parvovirus.",
  },
  {
    name: "DHLPP",
    defaultIntervalDays: 365,
    description: "Canine combination vaccine for distemper, hepatitis, leptospirosis, parainfluenza, and parvovirus.",
  },
  {
    name: "FVRCP",
    defaultIntervalDays: 365,
    description: "Feline combination vaccine for rhinotracheitis, calicivirus, and panleukopenia.",
  },
  {
    name: "FeLV",
    defaultIntervalDays: 365,
    description: "Feline leukemia vaccine.",
  },
  {
    name: "Bordetella",
    defaultIntervalDays: 365,
    description: "Bordetella vaccine.",
  },
  {
    name: "Canine Corona",
    defaultIntervalDays: 365,
    description: "Canine coronavirus vaccine.",
  },
  {
    name: "Canine Parvo",
    defaultIntervalDays: 365,
    description: "Canine parvovirus vaccine.",
  },
  {
    name: "Canine Distemper",
    defaultIntervalDays: 365,
    description: "Canine distemper vaccine.",
  },
  {
    name: "Feline Panleukopenia",
    defaultIntervalDays: 365,
    description: "Feline panleukopenia vaccine.",
  },
];

export default async function seedVaccineTypes(prisma: any) {
  for (const vaccineType of DEFAULT_VACCINE_TYPES) {
    await prisma.vaccineType.upsert({
      where: { name: vaccineType.name },
      update: {
        defaultIntervalDays: vaccineType.defaultIntervalDays,
        description: vaccineType.description,
      },
      create: {
        ...vaccineType,
        targetAnimalTypeId: null,
      },
    });
  }
}
