/**
 * Clinic patient (pet) service: CRUD, search, link owner, unique Pet ID and QR.
 * Patients are pets with optional owner (User) linkage; list is branch-scoped via appointments.
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
const { randomUUID } = require("crypto");

const PET_ID_PREFIX = "PET";

function generateUniquePetId(): string {
  const u = randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
  return `${PET_ID_PREFIX}-${u}`;
}

/**
 * List patients (pets) for a clinic branch.
 * When ownerId (userId) is provided, returns all pets for that owner (any branch).
 * Otherwise returns pets that have at least one appointment at this branch.
 */
async function listPatients(
  branchId: number,
  opts: { limit?: number; offset?: number; search?: string; ownerId?: number } = {}
): Promise<{ patients: any[]; total: number }> {
  const limit = Math.min(opts.limit ?? 50, 100);
  const offset = opts.offset ?? 0;
  const search = opts.search?.trim();
  const ownerId = opts.ownerId != null ? Number(opts.ownerId) : undefined;

  let petWhere: any = { deleted: false };

  if (ownerId != null) {
    petWhere.userId = ownerId;
  } else {
    const whereAppointment = { branchId };
    const petIdsSubquery = prisma.appointment.findMany({
      where: whereAppointment,
      distinct: ["petId"],
      select: { petId: true },
    });
    const petIds = (await petIdsSubquery)
      .map((a: { petId: number | null }) => a.petId)
      .filter((id: number | null): id is number => id != null);
    if (petIds.length === 0) {
      return { patients: [], total: 0 };
    }
    petWhere.id = { in: petIds };
  }

  if (search) {
    if (ownerId != null) {
      petWhere.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { uniquePetId: { contains: search, mode: "insensitive" } },
      ];
    } else {
      petWhere.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { uniquePetId: { contains: search, mode: "insensitive" } },
        {
          user: {
            OR: [
              { profile: { displayName: { contains: search, mode: "insensitive" } } },
              { profile: { username: { contains: search, mode: "insensitive" } } },
              { auth: { email: { contains: search, mode: "insensitive" } } },
              { auth: { phone: { contains: search, mode: "insensitive" } } },
            ],
          },
        },
      ];
    }
  }

  const [patients, total] = await Promise.all([
    prisma.pet.findMany({
      where: petWhere,
      include: {
        user: {
          select: {
            id: true,
            profile: { select: { displayName: true, username: true } },
            auth: { select: { email: true, phone: true } },
          },
        },
        animalType: { select: { id: true, name: true } },
        breed: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.pet.count({ where: petWhere }),
  ]);

  return {
    patients: patients.map((p: any) => {
      const { user, ...rest } = p;
      return {
        ...rest,
        owner: user
          ? {
              userId: user.id,
              displayName: user.profile?.displayName ?? null,
              username: user.profile?.username ?? null,
              email: user.auth?.email ?? null,
              phone: user.auth?.phone ?? null,
            }
          : null,
      };
    }),
    total,
  };
}

/**
 * Get a single patient (pet) by id. Optionally ensure branch has seen this pet (has appointment).
 */
async function getPatientByPetId(
  branchId: number,
  petId: number,
  options?: { requireBranchVisit?: boolean }
): Promise<any | null> {
  const requireBranch = options?.requireBranchVisit !== false;
  if (requireBranch) {
    const hasAppointment = await prisma.appointment.findFirst({
      where: { branchId, petId },
    });
    if (!hasAppointment) return null;
  }

  const pet = await prisma.pet.findFirst({
    where: { id: petId, deleted: false },
    include: {
      user: {
        select: {
          id: true,
          profile: { select: { displayName: true, username: true } },
          auth: { select: { email: true, phone: true } },
        },
      },
      animalType: { select: { id: true, name: true } },
      breed: { select: { id: true, name: true } },
    },
  });
  if (!pet) return null;

  return {
    ...pet,
    owner: pet.user
      ? {
          userId: pet.user.id,
          displayName: pet.user.profile?.displayName ?? null,
          username: pet.user.profile?.username ?? null,
          email: pet.user.auth?.email ?? null,
          phone: pet.user.auth?.phone ?? null,
        }
      : null,
  };
}

/**
 * Get patient by uniquePetId (for QR lookup).
 */
async function getPatientByUniqueId(uniquePetId: string): Promise<any | null> {
  const pet = await prisma.pet.findFirst({
    where: { uniquePetId, deleted: false },
    include: {
      user: {
        select: {
          id: true,
          profile: { select: { displayName: true, username: true } },
          auth: { select: { email: true, phone: true } },
        },
      },
      animalType: { select: { id: true, name: true } },
      breed: { select: { id: true, name: true } },
    },
  });
  if (!pet) return null;

  return {
    ...pet,
    owner: pet.user
      ? {
          userId: pet.user.id,
          displayName: pet.user.profile?.displayName ?? null,
          username: pet.user.profile?.username ?? null,
          email: pet.user.auth?.email ?? null,
          phone: pet.user.auth?.phone ?? null,
        }
      : null,
  };
}

/**
 * Register a new pet (patient) and optionally link to owner. Generates uniquePetId.
 */
async function registerPatient(
  branchId: number,
  data: {
    userId: number;
    name: string;
    animalTypeId: number;
    breedId?: number;
    sex?: string;
    dateOfBirth?: string | Date;
    microchipNumber?: string;
    allergies?: string[] | any;
    bloodType?: string;
    healthCardJson?: any;
    notes?: string;
    isRescue?: boolean;
    isNeutered?: boolean;
    foodHabits?: string;
    healthDisorders?: string;
  }
): Promise<any> {
  const uniquePetId = generateUniquePetId();
  const pet = await prisma.pet.create({
    data: {
      userId: data.userId,
      name: data.name.trim(),
      animalTypeId: data.animalTypeId,
      breedId: data.breedId ?? null,
      sex: (data.sex as any) ?? "UNKNOWN",
      dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
      microchipNumber: data.microchipNumber?.trim() || null,
      uniquePetId,
      qrCodeUrl: null,
      allergies: data.allergies ?? [],
      bloodType: data.bloodType?.trim() || null,
      healthCardJson: data.healthCardJson ?? {},
      notes: data.notes?.trim() || null,
      isRescue: data.isRescue ?? false,
      isNeutered: data.isNeutered ?? false,
      foodHabits: data.foodHabits?.trim() || null,
      healthDisorders: data.healthDisorders?.trim() || null,
    },
    include: {
      user: {
        select: {
          id: true,
          profile: { select: { displayName: true, username: true } },
          auth: { select: { email: true, phone: true } },
        },
      },
      animalType: { select: { id: true, name: true } },
      breed: { select: { id: true, name: true } },
    },
  });

  return {
    ...pet,
    owner: pet.user
      ? {
          userId: pet.user.id,
          displayName: pet.user.profile?.displayName ?? null,
          username: pet.user.profile?.username ?? null,
          email: pet.user.auth?.email ?? null,
          phone: pet.user.auth?.phone ?? null,
        }
      : null,
  };
}

/**
 * Update pet (patient) profile.
 */
async function updatePatient(
  branchId: number,
  petId: number,
  data: {
    name?: string;
    breedId?: number | null;
    sex?: string;
    dateOfBirth?: string | Date | null;
    microchipNumber?: string | null;
    allergies?: string[] | any;
    bloodType?: string | null;
    healthCardJson?: any;
    notes?: string | null;
    isRescue?: boolean;
    isNeutered?: boolean;
    foodHabits?: string | null;
    healthDisorders?: string | null;
    qrCodeUrl?: string | null;
  }
): Promise<any | null> {
  const existing = await prisma.pet.findFirst({
    where: { id: petId, deleted: false },
  });
  if (!existing) return null;

  const updatePayload: any = {};
  if (data.name !== undefined) updatePayload.name = data.name.trim();
  if (data.breedId !== undefined) updatePayload.breedId = data.breedId;
  if (data.sex !== undefined) updatePayload.sex = data.sex;
  if (data.dateOfBirth !== undefined) updatePayload.dateOfBirth = data.dateOfBirth ? new Date(data.dateOfBirth) : null;
  if (data.microchipNumber !== undefined) updatePayload.microchipNumber = data.microchipNumber?.trim() || null;
  if (data.allergies !== undefined) updatePayload.allergies = data.allergies;
  if (data.bloodType !== undefined) updatePayload.bloodType = data.bloodType?.trim() || null;
  if (data.healthCardJson !== undefined) updatePayload.healthCardJson = data.healthCardJson;
  if (data.notes !== undefined) updatePayload.notes = data.notes?.trim() || null;
  if (data.isRescue !== undefined) updatePayload.isRescue = data.isRescue;
  if (data.isNeutered !== undefined) updatePayload.isNeutered = data.isNeutered;
  if (data.foodHabits !== undefined) updatePayload.foodHabits = data.foodHabits?.trim() || null;
  if (data.healthDisorders !== undefined) updatePayload.healthDisorders = data.healthDisorders?.trim() || null;
  if (data.qrCodeUrl !== undefined) updatePayload.qrCodeUrl = data.qrCodeUrl;

  const pet = await prisma.pet.update({
    where: { id: petId },
    data: updatePayload,
    include: {
      user: {
        select: {
          id: true,
          profile: { select: { displayName: true, username: true } },
          auth: { select: { email: true, phone: true } },
        },
      },
      animalType: { select: { id: true, name: true } },
      breed: { select: { id: true, name: true } },
    },
  });

  return {
    ...pet,
    owner: pet.user
      ? {
          userId: pet.user.id,
          displayName: pet.user.profile?.displayName ?? null,
          username: pet.user.profile?.username ?? null,
          email: pet.user.auth?.email ?? null,
          phone: pet.user.auth?.phone ?? null,
        }
      : null,
  };
}

/**
 * Search owners (users) by phone or email for linking a new pet.
 */
async function findOwnerByPhoneOrEmail(phoneOrEmail: string): Promise<any | null> {
  const s = phoneOrEmail.trim();
  if (!s) return null;
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { auth: { phone: s } },
        { auth: { email: { equals: s, mode: "insensitive" } } },
      ],
    },
    select: {
      id: true,
      profile: { select: { displayName: true, username: true } },
      auth: { select: { email: true, phone: true } },
    },
  });
  return user;
}

module.exports = {
  generateUniquePetId,
  listPatients,
  getPatientByPetId,
  getPatientByUniqueId,
  registerPatient,
  updatePatient,
  findOwnerByPhoneOrEmail,
};
