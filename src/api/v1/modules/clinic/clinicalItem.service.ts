/**
 * Clinical Item Master: CRUD, search, activate/deactivate.
 * Separate from Product; used for surgery consumables, medicines, instruments, etc.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");

const DOMAIN_PREFIX: Record<string, string> = {
  MEDICINE: "MED",
  SURGICAL_CONSUMABLE: "CON",
  DRESSING_SUPPLY: "DRS",
  CLINIC_SUPPLY: "SUP",
  INSTRUMENT: "INS",
  IMPLANT: "IMP",
  SERVICE_SUPPORT: "SVC",
  PACKAGE_ONLY: "PKG",
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Generate next item code for org: {PREFIX}-{SEQ} */
async function generateItemCode(orgId: number, domainType: string): Promise<string> {
  const prefix = DOMAIN_PREFIX[domainType] ?? "ITM";
  const pattern = `${prefix}-%`;
  const last = await prisma.clinicalItem.findFirst({
    where: { orgId, itemCode: { startsWith: prefix } },
    orderBy: { itemCode: "desc" },
    select: { itemCode: true },
  });
  let seq = 1;
  if (last?.itemCode) {
    const match = last.itemCode.match(/-(\d+)$/);
    if (match) seq = parseInt(match[1], 10) + 1;
  }
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

/** List clinical items with filters */
export async function listClinicalItems(options: {
  orgId: number;
  domainType?: string;
  categoryId?: number;
  search?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}) {
  const page = options.page ?? 1;
  const limit = Math.min(options.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { orgId: options.orgId };
  if (options.domainType != null) where.domainType = options.domainType;
  if (options.categoryId != null) where.categoryId = options.categoryId;
  if (options.isActive != null) where.isActive = options.isActive;
  if (options.search && options.search.trim()) {
    const q = options.search.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { itemCode: { contains: q, mode: "insensitive" } },
      { slug: { contains: q, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.clinicalItem.findMany({
      where,
      skip,
      take: limit,
      include: {
        category: { select: { id: true, name: true } },
        consumableProfile: {
          select: {
            consumableType: true,
            sterileRequired: true,
            wastageTrackRequired: true,
            procedureLinked: true,
            issueUnit: true,
            usageNoteTemplate: true,
          },
        },
        instrumentProfile: {
          select: { sterilizationRequired: true },
        },
        _count: { select: { variants: true, packageItems: true } },
      },
      orderBy: [{ domainType: "asc" }, { itemCode: "asc" }],
    }),
    prisma.clinicalItem.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/** Get one clinical item by id (org-scoped optional) */
export async function getClinicalItemById(
  itemId: number,
  options?: { orgId?: number }
) {
  const where: Record<string, unknown> = { id: itemId };
  if (options?.orgId != null) where.orgId = options.orgId;

  const item = await prisma.clinicalItem.findFirst({
    where,
    include: {
      category: { select: { id: true, name: true, parentId: true } },
      variants: { orderBy: { variantName: "asc" } },
      medicineProfile: true,
      consumableProfile: true,
      instrumentProfile: true,
      media: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!item) throw new Error("Clinical item not found");
  return item;
}

/** Search for autocomplete (name, itemCode, slug; limit 20) */
export async function searchClinicalItems(options: {
  orgId: number;
  q?: string;
  domainType?: string;
  branchId?: number;
  limit?: number;
}) {
  const limit = Math.min(options.limit ?? 20, 50);
  const where: Record<string, unknown> = {
    orgId: options.orgId,
    isActive: true,
    isPackageEligible: true,
  };
  if (options.domainType != null) where.domainType = options.domainType;
  if (options.q && options.q.trim()) {
    const q = options.q.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { itemCode: { contains: q, mode: "insensitive" } },
      { slug: { contains: q, mode: "insensitive" } },
    ];
  }

  const items = await prisma.clinicalItem.findMany({
    where,
    take: limit,
    include: {
      category: { select: { name: true } },
      variants: {
        where: { isActive: true },
        select: { id: true, variantName: true, sku: true, defaultCost: true, defaultSalePrice: true },
        orderBy: { variantName: "asc" },
      },
    },
    orderBy: [{ name: "asc" }],
  });

  return items;
}

/** Upsert domain-specific profiles (medicine, consumable, instrument) */
async function upsertDomainProfiles(
  prisma: any,
  itemId: number,
  domainType: string,
  profiles: {
    medicineProfile?: Record<string, unknown> | null;
    consumableProfile?: Record<string, unknown> | null;
    instrumentProfile?: Record<string, unknown> | null;
  }
) {
  if (domainType === "MEDICINE" && profiles.medicineProfile) {
    const p = profiles.medicineProfile as Record<string, unknown>;
    await prisma.medicineItemProfile.upsert({
      where: { itemId },
      create: {
        itemId,
        genericName: p.genericName ?? undefined,
        dosageForm: p.dosageForm ?? undefined,
        strength: p.strength ?? undefined,
        route: p.route ?? undefined,
        pharmacologyClass: p.pharmacologyClass ?? undefined,
        requiresPrescription: p.requiresPrescription === true,
        controlledSubstance: p.controlledSubstance === true,
        dispenseUnit: p.dispenseUnit ?? undefined,
        batchMandatory: p.batchMandatory !== false,
        expiryMandatory: p.expiryMandatory !== false,
      },
      update: {
        genericName: p.genericName !== undefined ? p.genericName : undefined,
        dosageForm: p.dosageForm !== undefined ? p.dosageForm : undefined,
        strength: p.strength !== undefined ? p.strength : undefined,
        route: p.route !== undefined ? p.route : undefined,
        pharmacologyClass: p.pharmacologyClass !== undefined ? p.pharmacologyClass : undefined,
        requiresPrescription: p.requiresPrescription !== undefined ? p.requiresPrescription === true : undefined,
        controlledSubstance: p.controlledSubstance !== undefined ? p.controlledSubstance === true : undefined,
        dispenseUnit: p.dispenseUnit !== undefined ? p.dispenseUnit : undefined,
        batchMandatory: p.batchMandatory !== undefined ? p.batchMandatory === true : undefined,
        expiryMandatory: p.expiryMandatory !== undefined ? p.expiryMandatory === true : undefined,
      },
    });
  }
  const consumableDomains = ["SURGICAL_CONSUMABLE", "DRESSING_SUPPLY", "CLINIC_SUPPLY"];
  if (consumableDomains.includes(domainType) && profiles.consumableProfile) {
    const p = profiles.consumableProfile as Record<string, unknown>;
    await prisma.consumableItemProfile.upsert({
      where: { itemId },
      create: {
        itemId,
        consumableType: p.consumableType ?? "OTHER",
        sterileRequired: p.sterileRequired === true,
        singleUseOnly: p.singleUseOnly !== false,
        procedureLinked: p.procedureLinked === true,
        wastageTrackRequired: p.wastageTrackRequired === true,
        issueUnit: p.issueUnit ?? undefined,
        usageNoteTemplate: p.usageNoteTemplate ?? undefined,
      },
      update: {
        consumableType: p.consumableType !== undefined ? p.consumableType : undefined,
        sterileRequired: p.sterileRequired !== undefined ? p.sterileRequired === true : undefined,
        singleUseOnly: p.singleUseOnly !== undefined ? p.singleUseOnly !== false : undefined,
        procedureLinked: p.procedureLinked !== undefined ? p.procedureLinked === true : undefined,
        wastageTrackRequired: p.wastageTrackRequired !== undefined ? p.wastageTrackRequired === true : undefined,
        issueUnit: p.issueUnit !== undefined ? p.issueUnit : undefined,
        usageNoteTemplate: p.usageNoteTemplate !== undefined ? p.usageNoteTemplate : undefined,
      },
    });
  }
  if (domainType === "INSTRUMENT" && profiles.instrumentProfile) {
    const p = profiles.instrumentProfile as Record<string, unknown>;
    await prisma.instrumentItemProfile.upsert({
      where: { itemId },
      create: {
        itemId,
        instrumentType: p.instrumentType ?? "OTHER",
        sterilizationRequired: p.sterilizationRequired !== false,
        maintenanceRequired: p.maintenanceRequired === true,
        assetTrackingRequired: p.assetTrackingRequired === true,
        issueReturnRequired: p.issueReturnRequired !== false,
        serviceCycleDays: p.serviceCycleDays != null ? Number(p.serviceCycleDays) : undefined,
        serialTracking: p.serialTracking === true,
      },
      update: {
        instrumentType: p.instrumentType !== undefined ? p.instrumentType : undefined,
        sterilizationRequired: p.sterilizationRequired !== undefined ? p.sterilizationRequired !== false : undefined,
        maintenanceRequired: p.maintenanceRequired !== undefined ? p.maintenanceRequired === true : undefined,
        assetTrackingRequired: p.assetTrackingRequired !== undefined ? p.assetTrackingRequired === true : undefined,
        issueReturnRequired: p.issueReturnRequired !== undefined ? p.issueReturnRequired !== false : undefined,
        serviceCycleDays: p.serviceCycleDays !== undefined ? (p.serviceCycleDays != null ? Number(p.serviceCycleDays) : null) : undefined,
        serialTracking: p.serialTracking !== undefined ? p.serialTracking === true : undefined,
      },
    });
  }
}

/** Create clinical item (optionally with domain-specific profile) */
export async function createClinicalItem(data: {
  orgId: number;
  name: string;
  domainType: string;
  categoryId?: number | null;
  baseUnit?: string | null;
  description?: string | null;
  brandName?: string | null;
  manufacturerName?: string | null;
  isClinicUse?: boolean;
  isSellable?: boolean;
  isPackageEligible?: boolean;
  isInventoryTracked?: boolean;
  requiresBatch?: boolean;
  requiresExpiry?: boolean;
  isReusable?: boolean;
  isHighRisk?: boolean;
  defaultCost?: number | null;
  defaultSalePrice?: number | null;
  createdByUserId?: number | null;
  itemCode?: string | null;
  medicineProfile?: Record<string, unknown> | null;
  consumableProfile?: Record<string, unknown> | null;
  instrumentProfile?: Record<string, unknown> | null;
}) {
  const slug = slugify(data.name);
  const existingSlug = await prisma.clinicalItem.findFirst({
    where: { orgId: data.orgId, slug },
    select: { id: true },
  });
  const finalSlug = existingSlug ? `${slug}-${Date.now().toString(36)}` : slug;
  const itemCode =
    data.itemCode?.trim() ||
    (await generateItemCode(data.orgId, data.domainType));

  const item = await prisma.clinicalItem.create({
    data: {
      orgId: data.orgId,
      itemCode,
      name: data.name.trim(),
      slug: finalSlug,
      domainType: data.domainType,
      categoryId: data.categoryId ?? undefined,
      baseUnit: data.baseUnit ?? undefined,
      description: data.description ?? undefined,
      brandName: data.brandName ?? undefined,
      manufacturerName: data.manufacturerName ?? undefined,
      isClinicUse: data.isClinicUse ?? true,
      isSellable: data.isSellable ?? false,
      isPackageEligible: data.isPackageEligible ?? true,
      isInventoryTracked: data.isInventoryTracked ?? true,
      requiresBatch: data.requiresBatch ?? false,
      requiresExpiry: data.requiresExpiry ?? false,
      isReusable: data.isReusable ?? false,
      isHighRisk: data.isHighRisk ?? false,
      defaultCost: data.defaultCost ?? undefined,
      defaultSalePrice: data.defaultSalePrice ?? undefined,
      createdByUserId: data.createdByUserId ?? undefined,
    },
    include: {
      category: { select: { id: true, name: true } },
    },
  });

  await upsertDomainProfiles(prisma, item.id, data.domainType, {
    medicineProfile: data.medicineProfile,
    consumableProfile: data.consumableProfile,
    instrumentProfile: data.instrumentProfile,
  });

  return prisma.clinicalItem.findFirst({
    where: { id: item.id },
    include: {
      category: { select: { id: true, name: true } },
      medicineProfile: true,
      consumableProfile: true,
      instrumentProfile: true,
    },
  });
}

/** Update clinical item (optionally with domain-specific profile) */
export async function updateClinicalItem(
  itemId: number,
  orgId: number,
  data: {
    name?: string;
    categoryId?: number | null;
    baseUnit?: string | null;
    description?: string | null;
    brandName?: string | null;
    manufacturerName?: string | null;
    isClinicUse?: boolean;
    isSellable?: boolean;
    isPackageEligible?: boolean;
    isInventoryTracked?: boolean;
    requiresBatch?: boolean;
    requiresExpiry?: boolean;
    isReusable?: boolean;
    isHighRisk?: boolean;
    defaultCost?: number | null;
    defaultSalePrice?: number | null;
    updatedByUserId?: number | null;
    medicineProfile?: Record<string, unknown> | null;
    consumableProfile?: Record<string, unknown> | null;
    instrumentProfile?: Record<string, unknown> | null;
  }
) {
  const existing = await prisma.clinicalItem.findFirst({
    where: { id: itemId, orgId },
    select: { id: true, domainType: true },
  });
  if (!existing) throw new Error("Clinical item not found");

  const updateData: Record<string, unknown> = {};
  if (data.name != null) updateData.name = data.name.trim();
  if (data.categoryId !== undefined) updateData.categoryId = data.categoryId;
  if (data.baseUnit !== undefined) updateData.baseUnit = data.baseUnit;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.brandName !== undefined) updateData.brandName = data.brandName;
  if (data.manufacturerName !== undefined)
    updateData.manufacturerName = data.manufacturerName;
  if (data.isClinicUse != null) updateData.isClinicUse = data.isClinicUse;
  if (data.isSellable != null) updateData.isSellable = data.isSellable;
  if (data.isPackageEligible != null)
    updateData.isPackageEligible = data.isPackageEligible;
  if (data.isInventoryTracked != null)
    updateData.isInventoryTracked = data.isInventoryTracked;
  if (data.requiresBatch != null) updateData.requiresBatch = data.requiresBatch;
  if (data.requiresExpiry != null) updateData.requiresExpiry = data.requiresExpiry;
  if (data.isReusable != null) updateData.isReusable = data.isReusable;
  if (data.isHighRisk != null) updateData.isHighRisk = data.isHighRisk;
  if (data.defaultCost !== undefined) updateData.defaultCost = data.defaultCost;
  if (data.defaultSalePrice !== undefined)
    updateData.defaultSalePrice = data.defaultSalePrice;
  if (data.updatedByUserId !== undefined)
    updateData.updatedByUserId = data.updatedByUserId;

  if (data.name != null) {
    const slug = slugify(data.name);
    updateData.slug = slug;
  }

  await prisma.clinicalItem.update({
    where: { id: itemId },
    data: updateData,
  });

  await upsertDomainProfiles(prisma, itemId, (existing as { domainType: string }).domainType, {
    medicineProfile: data.medicineProfile,
    consumableProfile: data.consumableProfile,
    instrumentProfile: data.instrumentProfile,
  });

  return prisma.clinicalItem.findFirst({
    where: { id: itemId },
    include: {
      category: { select: { id: true, name: true } },
      variants: true,
      medicineProfile: true,
      consumableProfile: true,
      instrumentProfile: true,
    },
  });
}

/** Activate clinical item */
export async function activateClinicalItem(itemId: number, orgId: number) {
  const existing = await prisma.clinicalItem.findFirst({
    where: { id: itemId, orgId },
    select: { id: true },
  });
  if (!existing) throw new Error("Clinical item not found");
  return prisma.clinicalItem.update({
    where: { id: itemId },
    data: { isActive: true },
  });
}

/** Deactivate clinical item (soft) */
export async function deactivateClinicalItem(itemId: number, orgId: number) {
  const existing = await prisma.clinicalItem.findFirst({
    where: { id: itemId, orgId },
    select: { id: true },
  });
  if (!existing) throw new Error("Clinical item not found");
  return prisma.clinicalItem.update({
    where: { id: itemId },
    data: { isActive: false },
  });
}

/** Create variant for clinical item */
export async function createClinicalItemVariant(
  itemId: number,
  orgId: number,
  data: {
    variantName: string;
    sku?: string | null;
    barcode?: string | null;
    unitLabel?: string | null;
    packSize?: string | null;
    strengthOrSpec?: string | null;
    defaultCost?: number | null;
    defaultSalePrice?: number | null;
  }
) {
  const item = await prisma.clinicalItem.findFirst({
    where: { id: itemId, orgId },
    select: { id: true },
  });
  if (!item) throw new Error("Clinical item not found");

  return prisma.clinicalItemVariant.create({
    data: {
      itemId,
      variantName: data.variantName.trim(),
      sku: data.sku ?? undefined,
      barcode: data.barcode ?? undefined,
      unitLabel: data.unitLabel ?? undefined,
      packSize: data.packSize ?? undefined,
      strengthOrSpec: data.strengthOrSpec ?? undefined,
      defaultCost: data.defaultCost ?? undefined,
      defaultSalePrice: data.defaultSalePrice ?? undefined,
    },
  });
}

/** Update clinical item variant */
export async function updateClinicalItemVariant(
  variantId: number,
  orgId: number,
  data: {
    variantName?: string;
    sku?: string | null;
    barcode?: string | null;
    unitLabel?: string | null;
    packSize?: string | null;
    strengthOrSpec?: string | null;
    defaultCost?: number | null;
    defaultSalePrice?: number | null;
    isActive?: boolean;
  }
) {
  const variant = await prisma.clinicalItemVariant.findFirst({
    where: { id: variantId, item: { orgId } },
    select: { id: true },
  });
  if (!variant) throw new Error("Clinical item variant not found");

  return prisma.clinicalItemVariant.update({
    where: { id: variantId },
    data: {
      ...(data.variantName != null && { variantName: data.variantName.trim() }),
      ...(data.sku !== undefined && { sku: data.sku }),
      ...(data.barcode !== undefined && { barcode: data.barcode }),
      ...(data.unitLabel !== undefined && { unitLabel: data.unitLabel }),
      ...(data.packSize !== undefined && { packSize: data.packSize }),
      ...(data.strengthOrSpec !== undefined && {
        strengthOrSpec: data.strengthOrSpec,
      }),
      ...(data.defaultCost !== undefined && { defaultCost: data.defaultCost }),
      ...(data.defaultSalePrice !== undefined && {
        defaultSalePrice: data.defaultSalePrice,
      }),
      ...(data.isActive != null && { isActive: data.isActive }),
    },
  });
}
