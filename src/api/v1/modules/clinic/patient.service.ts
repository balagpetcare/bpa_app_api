/**
 * Clinic patient (pet) service: CRUD, search, link owner, unique Pet ID and QR.
 * Patients are pets with owner (User) linkage. Branch scope = appointment OR visit at branch OR clinic registration at branch.
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
const { randomUUID } = require("crypto");

const PET_ID_PREFIX = "PET";

/**
 * Resolve taxonomy names from FKs and custom text for snapshot fields.
 */
async function resolveTaxonomySnapshots(data: {
  animalTypeId: number;
  breedId?: number | null;
  subBreedId?: number | null;
  colorId?: number | null;
  coatPatternId?: number | null;
  sizeId?: number | null;
  customBreedText?: string | null;
  customColorText?: string | null;
}): Promise<{
  animalTypeNameSnapshot: string | null;
  breedNameSnapshot: string | null;
  subBreedNameSnapshot: string | null;
  colorNameSnapshot: string | null;
  coatPatternNameSnapshot: string | null;
  sizeNameSnapshot: string | null;
}> {
  const [animalType, breed, subBreed, color, coatPattern, size] = await Promise.all([
    data.animalTypeId ? prisma.animalType.findUnique({ where: { id: data.animalTypeId }, select: { name: true } }) : null,
    data.breedId ? prisma.breed.findUnique({ where: { id: data.breedId }, select: { name: true } }) : null,
    data.subBreedId ? prisma.subBreed.findUnique({ where: { id: data.subBreedId }, select: { name: true } }) : null,
    data.colorId ? prisma.animalColor.findUnique({ where: { id: data.colorId }, select: { name: true } }) : null,
    data.coatPatternId ? prisma.coatPattern.findUnique({ where: { id: data.coatPatternId }, select: { name: true } }) : null,
    data.sizeId ? prisma.animalSize.findUnique({ where: { id: data.sizeId }, select: { name: true } }) : null,
  ]);
  return {
    animalTypeNameSnapshot: animalType?.name ?? null,
    breedNameSnapshot: (data.customBreedText?.trim() || breed?.name) ?? null,
    subBreedNameSnapshot: subBreed?.name ?? null,
    colorNameSnapshot: (data.customColorText?.trim() || color?.name) ?? null,
    coatPatternNameSnapshot: coatPattern?.name ?? null,
    sizeNameSnapshot: size?.name ?? null,
  };
}

function generateUniquePetId(): string {
  const u = randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
  return `${PET_ID_PREFIX}-${u}`;
}

/** Pet is visible in this branch if it has an appointment, a visit, or was registered here. */
async function isPetInBranchScope(branchId: number, petId: number): Promise<boolean> {
  const [appt, vis, reg] = await Promise.all([
    prisma.appointment.findFirst({ where: { branchId, petId }, select: { id: true } }),
    prisma.visit.findFirst({ where: { branchId, petId }, select: { id: true } }),
    prisma.pet.findFirst({
      where: { id: petId, deleted: false, clinicRegisteredBranchId: branchId },
      select: { id: true },
    }),
  ]);
  return !!(appt || vis || reg);
}

async function collectBranchScopedPetIds(branchId: number): Promise<number[]> {
  const [apptRows, visitRows, regRows] = await Promise.all([
    prisma.appointment.findMany({
      where: { branchId },
      distinct: ["petId"],
      select: { petId: true },
    }),
    prisma.visit.findMany({
      where: { branchId },
      distinct: ["petId"],
      select: { petId: true },
    }),
    prisma.pet.findMany({
      where: { deleted: false, clinicRegisteredBranchId: branchId },
      select: { id: true },
    }),
  ]);
  const idSet = new Set<number>();
  for (const r of apptRows) {
    if (r.petId != null) idSet.add(r.petId);
  }
  for (const r of visitRows) {
    if (r.petId != null) idSet.add(r.petId);
  }
  for (const r of regRows) {
    idSet.add(r.id);
  }
  return Array.from(idSet);
}

/**
 * List patients (pets) for a clinic branch.
 * When ownerId (userId) is provided, returns that owner's pets **that are also in this branch's scope**
 * (appointment, visit, or clinicRegisteredBranchId) — same visibility rule as the directory list.
 * Otherwise returns all pets tied to this branch via appointment, visit, or clinic registration.
 */
async function listPatients(
  branchId: number,
  opts: {
    limit?: number;
    offset?: number;
    search?: string;
    ownerId?: number;
    animalTypeId?: number;
  } = {}
): Promise<{ patients: any[]; total: number }> {
  const limit = Math.min(opts.limit ?? 50, 100);
  const offset = opts.offset ?? 0;
  const search = opts.search?.trim();
  const ownerId = opts.ownerId != null ? Number(opts.ownerId) : undefined;
  const animalTypeId = opts.animalTypeId != null && Number.isFinite(Number(opts.animalTypeId)) ? Number(opts.animalTypeId) : undefined;

  let petWhere: any = { deleted: false };

  if (ownerId != null) {
    petWhere.userId = ownerId;
    const scopedIds = await collectBranchScopedPetIds(branchId);
    if (scopedIds.length === 0) {
      return { patients: [], total: 0 };
    }
    petWhere.id = { in: scopedIds };
  } else {
    const petIds = await collectBranchScopedPetIds(branchId);
    if (petIds.length === 0) {
      return { patients: [], total: 0 };
    }
    petWhere.id = { in: petIds };
  }

  if (animalTypeId != null) {
    petWhere.animalTypeId = animalTypeId;
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
        subBreed: { select: { id: true, name: true } },
        color: { select: { id: true, name: true } },
        coatPattern: { select: { id: true, name: true } },
        size: { select: { id: true, name: true } },
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
 * Get a single patient (pet) by id. By default requires branch scope (appointment, visit, or registration).
 */
async function getPatientByPetId(
  branchId: number,
  petId: number,
  options?: { requireBranchVisit?: boolean }
): Promise<any | null> {
  const requireBranch = options?.requireBranchVisit !== false;
  if (requireBranch) {
    const ok = await isPetInBranchScope(branchId, petId);
    if (!ok) return null;
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
      subBreed: { select: { id: true, name: true } },
      color: { select: { id: true, name: true } },
      coatPattern: { select: { id: true, name: true } },
      size: { select: { id: true, name: true } },
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
      subBreed: { select: { id: true, name: true } },
      color: { select: { id: true, name: true } },
      coatPattern: { select: { id: true, name: true } },
      size: { select: { id: true, name: true } },
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
 * Canonical model: userId (owner) is required; no Pet without owner.
 */
async function registerPatient(
  branchId: number,
  data: {
    userId: number;
    name: string;
    animalTypeId: number;
    breedId?: number;
    subBreedId?: number | null;
    colorId?: number | null;
    coatPatternId?: number | null;
    sizeId?: number | null;
    customBreedText?: string | null;
    customColorText?: string | null;
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
  const ownerId = data.userId != null ? Number(data.userId) : null;
  if (!ownerId || !Number.isFinite(ownerId)) {
    const err: any = new Error("userId is required and must be a valid owner (User) id");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  const microchip = data.microchipNumber?.trim() || null;
  if (microchip) {
    const existing = await prisma.pet.findFirst({
      where: { microchipNumber: microchip, deleted: false },
      select: { id: true },
    });
    if (existing) {
      const err: any = new Error("This microchip number is already used.");
      err.code = "DUPLICATE_PET";
      throw err;
    }
  }
  const snapshots = await resolveTaxonomySnapshots({
    animalTypeId: data.animalTypeId,
    breedId: data.breedId ?? null,
    subBreedId: data.subBreedId ?? null,
    colorId: data.colorId ?? null,
    coatPatternId: data.coatPatternId ?? null,
    sizeId: data.sizeId ?? null,
    customBreedText: data.customBreedText ?? null,
    customColorText: data.customColorText ?? null,
  });
  const uniquePetId = generateUniquePetId();
  const pet = await prisma.pet.create({
    data: {
      userId: ownerId,
      clinicRegisteredBranchId: branchId,
      name: data.name.trim(),
      animalTypeId: data.animalTypeId,
      breedId: data.breedId ?? null,
      subBreedId: data.subBreedId ?? null,
      colorId: data.colorId ?? null,
      coatPatternId: data.coatPatternId ?? null,
      sizeId: data.sizeId ?? null,
      animalTypeNameSnapshot: snapshots.animalTypeNameSnapshot,
      breedNameSnapshot: snapshots.breedNameSnapshot,
      subBreedNameSnapshot: snapshots.subBreedNameSnapshot,
      colorNameSnapshot: snapshots.colorNameSnapshot,
      coatPatternNameSnapshot: snapshots.coatPatternNameSnapshot,
      sizeNameSnapshot: snapshots.sizeNameSnapshot,
      customBreedText: data.customBreedText?.trim() || null,
      customColorText: data.customColorText?.trim() || null,
      sex: (data.sex as any) ?? "UNKNOWN",
      dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
      microchipNumber: microchip ?? null,
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
      subBreed: { select: { id: true, name: true } },
      color: { select: { id: true, name: true } },
      coatPattern: { select: { id: true, name: true } },
      size: { select: { id: true, name: true } },
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
    subBreedId?: number | null;
    colorId?: number | null;
    coatPatternId?: number | null;
    sizeId?: number | null;
    customBreedText?: string | null;
    customColorText?: string | null;
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
  const inScope = await isPetInBranchScope(branchId, petId);
  if (!inScope) return null;

  const existing = await prisma.pet.findFirst({
    where: { id: petId, deleted: false },
  });
  if (!existing) return null;

  const updatePayload: any = {};
  if (data.name !== undefined) updatePayload.name = data.name.trim();
  if (data.breedId !== undefined) updatePayload.breedId = data.breedId;
  if (data.subBreedId !== undefined) updatePayload.subBreedId = data.subBreedId;
  if (data.colorId !== undefined) updatePayload.colorId = data.colorId;
  if (data.coatPatternId !== undefined) updatePayload.coatPatternId = data.coatPatternId;
  if (data.sizeId !== undefined) updatePayload.sizeId = data.sizeId;
  if (data.customBreedText !== undefined) updatePayload.customBreedText = data.customBreedText?.trim() || null;
  if (data.customColorText !== undefined) updatePayload.customColorText = data.customColorText?.trim() || null;
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

  const taxonomyKeys = ["subBreedId", "colorId", "coatPatternId", "sizeId", "customBreedText", "customColorText", "breedId"];
  const taxonomyChanged = taxonomyKeys.some((k) => data[k as keyof typeof data] !== undefined);
  if (taxonomyChanged) {
    const snapshots = await resolveTaxonomySnapshots({
      animalTypeId: existing.animalTypeId,
      breedId: data.breedId !== undefined ? data.breedId : existing.breedId,
      subBreedId: data.subBreedId !== undefined ? data.subBreedId : existing.subBreedId,
      colorId: data.colorId !== undefined ? data.colorId : existing.colorId,
      coatPatternId: data.coatPatternId !== undefined ? data.coatPatternId : existing.coatPatternId,
      sizeId: data.sizeId !== undefined ? data.sizeId : existing.sizeId,
      customBreedText: data.customBreedText !== undefined ? data.customBreedText : existing.customBreedText,
      customColorText: data.customColorText !== undefined ? data.customColorText : existing.customColorText,
    });
    updatePayload.animalTypeNameSnapshot = snapshots.animalTypeNameSnapshot;
    updatePayload.breedNameSnapshot = snapshots.breedNameSnapshot;
    updatePayload.subBreedNameSnapshot = snapshots.subBreedNameSnapshot;
    updatePayload.colorNameSnapshot = snapshots.colorNameSnapshot;
    updatePayload.coatPatternNameSnapshot = snapshots.coatPatternNameSnapshot;
    updatePayload.sizeNameSnapshot = snapshots.sizeNameSnapshot;
  }

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
      subBreed: { select: { id: true, name: true } },
      color: { select: { id: true, name: true } },
      coatPattern: { select: { id: true, name: true } },
      size: { select: { id: true, name: true } },
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
 * Link pet to another owner (User). Reassigns Pet.userId. Used when correcting ownership.
 */
async function linkPetToOwner(branchId: number, petId: number, userId: number): Promise<any | null> {
  const ok = await isPetInBranchScope(branchId, petId);
  if (!ok) return null;

  const [pet, user] = await Promise.all([
    prisma.pet.findFirst({ where: { id: petId, deleted: false }, select: { id: true, userId: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
  ]);
  if (!pet) return null;
  if (!user) return null;

  const updated = await prisma.pet.update({
    where: { id: petId },
    data: { userId },
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
      subBreed: { select: { id: true, name: true } },
      color: { select: { id: true, name: true } },
      coatPattern: { select: { id: true, name: true } },
      size: { select: { id: true, name: true } },
    },
  });
  return {
    ...updated,
    owner: updated.user
      ? {
          userId: updated.user.id,
          displayName: updated.user.profile?.displayName ?? null,
          username: updated.user.profile?.username ?? null,
          email: updated.user.auth?.email ?? null,
          phone: updated.user.auth?.phone ?? null,
        }
      : null,
  };
}

/** Normalize phone to digits-only for matching (e.g. 01777888993 / +8801777888993 -> 1777888993). */
function normalizePhoneDigits(v: string | null | undefined): string {
  return String(v || "").replace(/\D/g, "");
}

/**
 * Search owners (users) by phone or email for linking a new pet.
 * Phone matching uses normalized digits and common variants (exact, 0-prefix, 88-prefix for BD)
 * so that 01777888993 finds the same owner as +8801777888993.
 */
async function findOwnerByPhoneOrEmail(phoneOrEmail: string): Promise<any | null> {
  const s = phoneOrEmail.trim();
  if (!s) return null;

  const isEmail = s.includes("@");
  const orConditions: any[] = [];

  if (isEmail) {
    orConditions.push({ auth: { email: { equals: s, mode: "insensitive" } } });
  } else {
    const digits = normalizePhoneDigits(s);
    const phoneCandidates: string[] = [s];
    if (digits) {
      phoneCandidates.push(digits);
      if (digits.length === 10) {
        phoneCandidates.push("0" + digits);
        phoneCandidates.push("88" + digits);
        phoneCandidates.push("880" + digits);
      } else if (digits.length === 11 && digits.startsWith("0")) {
        phoneCandidates.push("88" + digits.slice(1));
        phoneCandidates.push("880" + digits.slice(1));
      } else if (digits.length >= 11) {
        const withoutLeading88 = digits.startsWith("88") ? digits.slice(2) : digits;
        if (withoutLeading88.length === 10) {
          phoneCandidates.push("0" + withoutLeading88);
        }
      }
    }
    const uniquePhones = [...new Set(phoneCandidates)];
    uniquePhones.forEach((phone) => {
      if (phone) orConditions.push({ auth: { phone } });
    });
  }

  if (orConditions.length === 0) return null;

  const user = await prisma.user.findFirst({
    where: { OR: orConditions },
    select: {
      id: true,
      profile: { select: { displayName: true, username: true } },
      auth: { select: { email: true, phone: true } },
    },
  });
  return user;
}

/**
 * Ensure an owner (User) exists for the given phone and/or email. If a user with this phone or email exists, return it.
 * Otherwise create a minimal User with auth.phone/email and profile.displayName for clinic intake/registration flow.
 * Prevents duplicate owners by normalizing phone/email and checking first.
 * At least one of phone or email is required.
 */
async function ensureOwner(params: { phone?: string; email?: string; displayName?: string }): Promise<any> {
  const phone = (params.phone || "").trim();
  const email = (params.email || "").trim();
  const displayName = (params.displayName || "").trim();

  if (!phone && !email) {
    throw new Error("Phone or email is required");
  }

  // Check if owner already exists by phone or email
  if (phone) {
    const existing = await findOwnerByPhoneOrEmail(phone);
    if (existing) return existing;
  }
  if (email && !phone) {
    const existing = await findOwnerByPhoneOrEmail(email);
    if (existing) return existing;
  }

  // Prepare phone data
  let canonicalPhone: string | null = null;
  let usernameBase = "owner";
  if (phone) {
    const digits = normalizePhoneDigits(phone);
    if (digits) {
      canonicalPhone = digits.length === 10 ? "0" + digits : digits.startsWith("0") ? digits : "0" + digits.slice(-10);
      usernameBase = `owner_${digits.slice(-9)}`;
    }
  }

  // Prepare email data
  const canonicalEmail = email || null;
  if (email && !canonicalPhone) {
    usernameBase = `owner_${email.split("@")[0].replace(/[^a-z0-9]/gi, "").slice(0, 15)}`;
  }

  const name = displayName || "Pet Owner";
  const username = `${usernameBase}_${Date.now().toString(36)}`.slice(0, 30);

  try {
    const user = await prisma.user.create({
      data: {
        status: "ACTIVE",
        auth: {
          create: {
            provider: "LOCAL",
            phone: canonicalPhone,
            email: canonicalEmail,
            passwordHash: null,
          },
        },
        profile: {
          create: {
            displayName: name,
            username,
          },
        },
      },
      select: {
        id: true,
        profile: { select: { displayName: true, username: true } },
        auth: { select: { email: true, phone: true } },
      },
    });
    try {
      await prisma.ownerProfile.create({
        data: {
          userId: user.id,
          name,
          supportPhone: canonicalPhone,
        },
      });
    } catch (opErr) {
      if (opErr?.code !== "P2002") throw opErr;
    }
    return user;
  } catch (err) {
    if (err?.code === "P2002") {
      const existing = await findOwnerByPhoneOrEmail(phone || email);
      return existing;
    }
    throw err;
  }
}

// Backward compatibility alias
async function ensureOwnerByPhone(phone: string, displayName?: string): Promise<any> {
  return ensureOwner({ phone, displayName });
}

type ClinicalOverviewResolution =
  | { kind: "OK"; data: any }
  | { kind: "NOT_FOUND" }
  | { kind: "NOT_IN_BRANCH" };

/**
 * Aggregated clinical context for staff patient workspace (caller must verify branch scope).
 */
async function loadPatientClinicalOverviewData(branchId: number, petId: number): Promise<any | null> {
  const patient = await getPatientByPetId(branchId, petId, { requireBranchVisit: false });
  if (!patient) return null;

  const [
    visits,
    visitsTotal,
    vaccinations,
    vaccinationsNextDue,
    prescriptions,
    surgeries,
    recentOrders,
  ] = await Promise.all([
    prisma.visit.findMany({
      where: { branchId, petId },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        status: true,
        treatmentCode: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        doctor: {
          select: { id: true, user: { select: { profile: { select: { displayName: true } } } } },
        },
      },
    }),
    prisma.visit.count({ where: { branchId, petId } }),
    prisma.vaccination.findMany({
      where: { petId },
      include: { vaccineType: { select: { id: true, name: true } } },
      orderBy: { administeredAt: "desc" },
      take: 12,
    }),
    prisma.vaccination.findMany({
      where: { petId, nextDueDate: { not: null, gte: new Date() } },
      include: { vaccineType: { select: { id: true, name: true } } },
      orderBy: { nextDueDate: "asc" },
      take: 8,
    }),
    prisma.prescription.findMany({
      where: { petId, visit: { branchId } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        notes: true,
        createdAt: true,
        visitId: true,
        visit: { select: { id: true, treatmentCode: true, status: true } },
        doctor: { select: { user: { select: { profile: { select: { displayName: true } } } } } },
        items: { take: 6, select: { medicineName: true, dosage: true, frequency: true } },
      },
    }),
    prisma.surgeryCase.findMany({
      where: { branchId, petId },
      orderBy: [{ scheduledStartAt: "desc" }, { id: "desc" }],
      take: 12,
      select: {
        id: true,
        caseNumber: true,
        status: true,
        scheduledStartAt: true,
        createdAt: true,
        surgeryType: true,
        service: { select: { name: true } },
      },
    }),
    prisma.order.findMany({
      where: { branchId, visit: { petId } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        orderNumber: true,
        totalAmount: true,
        paymentStatus: true,
        createdAt: true,
        visitId: true,
        clinicInvoice: { select: { id: true, billingStatus: true } },
      },
    }),
  ]);

  const lastVisit = visits[0] ?? null;

  const alerts: string[] = [];
  const allergies = patient.allergies;
  if (Array.isArray(allergies) && allergies.length > 0) {
    alerts.push(`Allergies on file: ${allergies.join(", ")}`);
  } else if (allergies && typeof allergies === "string" && allergies.trim()) {
    alerts.push(`Allergies on file: ${allergies}`);
  }
  for (const v of vaccinationsNextDue) {
    if (v.nextDueDate) {
      alerts.push(
        `Vaccine due: ${v.vaccineType?.name ?? "Vaccine"} by ${new Date(v.nextDueDate).toLocaleDateString()}`
      );
    }
  }

  const timeline: { type: string; at: string; label: string; id: number; meta?: any }[] = [];
  const pushTime = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : 0);

  for (const v of visits) {
    timeline.push({
      type: "visit",
      at: (v.completedAt || v.startedAt || v.createdAt) as any,
      label: v.treatmentCode ? `Visit ${v.treatmentCode}` : `Visit #${v.id}`,
      id: v.id,
      meta: { status: v.status },
    });
  }
  for (const s of surgeries) {
    timeline.push({
      type: "surgery",
      at: (s.scheduledStartAt || s.createdAt) as any,
      label: `Surgery ${s.caseNumber}`,
      id: s.id,
      meta: { status: s.status },
    });
  }
  for (const p of prescriptions) {
    timeline.push({
      type: "prescription",
      at: p.createdAt as any,
      label: `Prescription #${p.id}`,
      id: p.id,
      meta: { status: p.status, visitId: p.visitId },
    });
  }
  for (const o of recentOrders) {
    timeline.push({
      type: "billing",
      at: o.createdAt as any,
      label: `Order ${o.orderNumber}`,
      id: o.id,
      meta: { paymentStatus: o.paymentStatus, visitId: o.visitId },
    });
  }
  timeline.sort((a, b) => pushTime(b.at) - pushTime(a.at));

  return {
    patient,
    lastVisit,
    visits,
    visitsTotal,
    vaccinations,
    vaccinationsNextDue,
    prescriptions,
    surgeries,
    billingRecentOrders: recentOrders,
    alerts,
    timeline: timeline.slice(0, 40),
  };
}

/**
 * Distinguish missing pet vs pet not linked to this branch (for clearer 404 messaging).
 */
async function resolvePatientClinicalOverview(branchId: number, petId: number): Promise<ClinicalOverviewResolution> {
  const exists = await prisma.pet.findFirst({
    where: { id: petId, deleted: false },
    select: { id: true },
  });
  if (!exists) return { kind: "NOT_FOUND" };
  const scoped = await isPetInBranchScope(branchId, petId);
  if (!scoped) return { kind: "NOT_IN_BRANCH" };
  const data = await loadPatientClinicalOverviewData(branchId, petId);
  if (!data) return { kind: "NOT_FOUND" };
  return { kind: "OK", data };
}

type PatientRecordResolution =
  | { kind: "OK"; data: any }
  | { kind: "NOT_FOUND" }
  | { kind: "NOT_IN_BRANCH" };

/**
 * Same access rules as clinical overview: pet must exist and be in branch scope.
 * Used for GET/PATCH patient so 404 messaging matches overview.
 */
async function resolvePatientForBranch(branchId: number, petId: number): Promise<PatientRecordResolution> {
  const exists = await prisma.pet.findFirst({
    where: { id: petId, deleted: false },
    select: { id: true },
  });
  if (!exists) return { kind: "NOT_FOUND" };
  const scoped = await isPetInBranchScope(branchId, petId);
  if (!scoped) return { kind: "NOT_IN_BRANCH" };
  const patient = await getPatientByPetId(branchId, petId, { requireBranchVisit: false });
  if (!patient) return { kind: "NOT_FOUND" };
  return { kind: "OK", data: patient };
}

async function getPatientClinicalOverview(branchId: number, petId: number): Promise<any | null> {
  const r = await resolvePatientClinicalOverview(branchId, petId);
  return r.kind === "OK" ? r.data : null;
}

module.exports = {
  generateUniquePetId,
  isPetInBranchScope,
  listPatients,
  getPatientByPetId,
  getPatientByUniqueId,
  getPatientClinicalOverview,
  resolvePatientClinicalOverview,
  resolvePatientForBranch,
  registerPatient,
  updatePatient,
  linkPetToOwner,
  findOwnerByPhoneOrEmail,
  ensureOwner,
  ensureOwnerByPhone,
};
