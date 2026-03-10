/**
 * Surgery Package Engine: CRUD for SurgeryPackage, PackageItem, PackagePriceRule;
 * package suggestion for service/species; package composition calculator.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");
// AppointmentStatus enum values for Prisma (runtime-safe; Prisma namespace can be undefined in some builds)
const AppointmentStatus = {
  CANCELLED: "CANCELLED",
  BOOKED: "BOOKED",
  CONFIRMED: "CONFIRMED",
  CHECKED_IN: "CHECKED_IN",
  IN_CONSULT: "IN_CONSULT",
} as const;

const PACKAGE_TYPE = [
  "STANDARD",
  "PREMIUM",
  "WELFARE",
  "EMERGENCY",
  "PROMOTIONAL",
  "DOCTOR_SPECIFIC",
  "BRANCH_SPECIFIC",
] as const;

export type PackageType = (typeof PACKAGE_TYPE)[number];
export type PackageItemType = "INCLUDED" | "INFORMATIONAL" | "ADDON_ELIGIBLE";

const VALID_PACKAGE_ITEM_TYPES: PackageItemType[] = ["INCLUDED", "INFORMATIONAL", "ADDON_ELIGIBLE"];

/** List surgery packages for a branch with optional filters */
export async function listPackages(options: {
  branchId: number;
  orgId?: number;
  serviceId?: number;
  packageType?: string;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const page = options.page ?? 1;
  const limit = Math.min(options.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { branchId: options.branchId };
  if (options.orgId != null) where.orgId = options.orgId;
  if (options.serviceId != null) where.serviceId = options.serviceId;
  if (options.packageType != null) where.packageType = options.packageType;
  if (options.status != null) where.status = options.status;

  const [items, total] = await Promise.all([
    prisma.surgeryPackage.findMany({
      where,
      skip,
      take: limit,
      include: {
        service: { select: { id: true, name: true, category: true, serviceCode: true } },
        _count: { select: { items: true, priceRules: true } },
      },
      orderBy: { packageCode: "asc" },
    }),
    prisma.surgeryPackage.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/** Get one surgery package by id */
export async function getPackageById(packageId: number, branchId: number) {
  const pkg = await prisma.surgeryPackage.findFirst({
    where: { id: packageId, branchId },
    include: {
      service: { select: { id: true, name: true, category: true, serviceCode: true } },
      branch: { select: { id: true, name: true } },
      updatedBy: {
        include: {
          profile: { select: { displayName: true } },
          auth: { select: { email: true } },
        },
      },
      items: {
        include: {
          product: { select: { id: true, name: true } },
          variant: { select: { id: true, sku: true, title: true } },
          clinicalItem: { select: { id: true, name: true, itemCode: true } },
          clinicalItemVariant: { select: { id: true, variantName: true, sku: true } },
        },
      },
      priceRules: true,
    },
  });
  if (!pkg) throw new Error("Surgery package not found");
  // Map updatedBy to { id, name, email } for frontend (User has no name/email; they live in profile/auth)
  const u = pkg.updatedBy as { id: number; profile?: { displayName: string } | null; auth?: { email: string | null } | null } | null;
  const updatedBy =
    u != null
      ? {
          id: u.id,
          name: u.profile?.displayName ?? u.auth?.email ?? null,
          email: u.auth?.email ?? null,
        }
      : null;
  return { ...pkg, updatedBy };
}

/** Create surgery package */
export async function createPackage(data: {
  orgId: number;
  branchId: number;
  serviceId: number;
  packageCode: string;
  packageName: string;
  packageType?: PackageType;
  baseSellingPrice: number;
  validFrom?: Date | null;
  validTo?: Date | null;
  doctorFeeAmount?: number | null;
  clinicFeeAmount?: number | null;
  consumableBlockAmount?: number | null;
  medicationBlockAmount?: number | null;
  supportFeeAmount?: number | null;
  estimatedCost?: number | null;
  emergencySurchargeRule?: object | null;
  addOnAllowed?: boolean;
  discountable?: boolean;
  speciesCondition?: string[] | object | null;
  status?: string;
  eligibilityRuleJson?: object | null;
  availabilityRuleJson?: object | null;
  minSellingPrice?: number | null;
  maxDiscountPct?: number | null;
  maxDiscountAmount?: number | null;
  taxApplicable?: boolean;
  branchOverrideAllowed?: boolean;
  description?: string | null;
  publicDescription?: string | null;
  internalNotes?: string | null;
  department?: string | null;
  breedNote?: string | null;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
}) {
  const pkg = await prisma.surgeryPackage.create({
    data: {
      orgId: data.orgId,
      branchId: data.branchId,
      serviceId: data.serviceId,
      packageCode: data.packageCode.trim(),
      packageName: data.packageName.trim(),
      packageType: data.packageType ?? "STANDARD",
      baseSellingPrice: data.baseSellingPrice,
      validFrom: data.validFrom ?? undefined,
      validTo: data.validTo ?? undefined,
      doctorFeeAmount: data.doctorFeeAmount ?? undefined,
      clinicFeeAmount: data.clinicFeeAmount ?? undefined,
      consumableBlockAmount: data.consumableBlockAmount ?? undefined,
      medicationBlockAmount: data.medicationBlockAmount ?? undefined,
      supportFeeAmount: data.supportFeeAmount ?? undefined,
      estimatedCost: data.estimatedCost ?? undefined,
      emergencySurchargeRule: data.emergencySurchargeRule ?? undefined,
      addOnAllowed: data.addOnAllowed ?? true,
      discountable: data.discountable ?? true,
      speciesCondition: data.speciesCondition ?? undefined,
      status: data.status ?? "ACTIVE",
      eligibilityRuleJson: data.eligibilityRuleJson ?? undefined,
      availabilityRuleJson: data.availabilityRuleJson ?? undefined,
      minSellingPrice: data.minSellingPrice ?? undefined,
      maxDiscountPct: data.maxDiscountPct ?? undefined,
      maxDiscountAmount: data.maxDiscountAmount ?? undefined,
      taxApplicable: data.taxApplicable ?? false,
      branchOverrideAllowed: data.branchOverrideAllowed ?? false,
      description: data.description ?? undefined,
      publicDescription: data.publicDescription ?? undefined,
      internalNotes: data.internalNotes ?? undefined,
      department: data.department ?? undefined,
      breedNote: data.breedNote ?? undefined,
      effectiveFrom: data.effectiveFrom ?? undefined,
      effectiveTo: data.effectiveTo ?? undefined,
    },
    include: { service: { select: { id: true, name: true } } },
  });
  return pkg;
}

/** Update surgery package */
export async function updatePackage(
  packageId: number,
  branchId: number,
  data: {
    packageName?: string;
    packageType?: PackageType;
    baseSellingPrice?: number;
    validFrom?: Date | null;
    validTo?: Date | null;
    doctorFeeAmount?: number | null;
    clinicFeeAmount?: number | null;
    consumableBlockAmount?: number | null;
    medicationBlockAmount?: number | null;
    supportFeeAmount?: number | null;
    estimatedCost?: number | null;
    emergencySurchargeRule?: object | null;
    addOnAllowed?: boolean;
    discountable?: boolean;
    speciesCondition?: string[] | object | null;
    status?: string;
    eligibilityRuleJson?: object | null;
    availabilityRuleJson?: object | null;
    minSellingPrice?: number | null;
    maxDiscountPct?: number | null;
    maxDiscountAmount?: number | null;
    taxApplicable?: boolean;
    branchOverrideAllowed?: boolean;
    description?: string | null;
    publicDescription?: string | null;
    internalNotes?: string | null;
    department?: string | null;
    breedNote?: string | null;
    updatedByUserId?: number | null;
    effectiveFrom?: Date | null;
    effectiveTo?: Date | null;
    serviceId?: number;
  }
) {
  const existing = await prisma.surgeryPackage.findFirst({
    where: { id: packageId, branchId },
  });
  if (!existing) throw new Error("Surgery package not found");

  const updateData: Record<string, unknown> = {
    ...(data.packageName != null && { packageName: data.packageName.trim() }),
    ...(data.packageType != null && { packageType: data.packageType }),
    ...(data.baseSellingPrice != null && { baseSellingPrice: data.baseSellingPrice }),
    ...(data.validFrom !== undefined && { validFrom: data.validFrom }),
    ...(data.validTo !== undefined && { validTo: data.validTo }),
    ...(data.doctorFeeAmount !== undefined && { doctorFeeAmount: data.doctorFeeAmount }),
    ...(data.clinicFeeAmount !== undefined && { clinicFeeAmount: data.clinicFeeAmount }),
    ...(data.consumableBlockAmount !== undefined && { consumableBlockAmount: data.consumableBlockAmount }),
    ...(data.medicationBlockAmount !== undefined && { medicationBlockAmount: data.medicationBlockAmount }),
    ...(data.supportFeeAmount !== undefined && { supportFeeAmount: data.supportFeeAmount }),
    ...(data.estimatedCost !== undefined && { estimatedCost: data.estimatedCost }),
    ...(data.emergencySurchargeRule !== undefined && { emergencySurchargeRule: data.emergencySurchargeRule }),
    ...(data.addOnAllowed != null && { addOnAllowed: data.addOnAllowed }),
    ...(data.discountable != null && { discountable: data.discountable }),
    ...(data.speciesCondition !== undefined && { speciesCondition: data.speciesCondition }),
    ...(data.status != null && { status: data.status }),
    ...(data.eligibilityRuleJson !== undefined && { eligibilityRuleJson: data.eligibilityRuleJson }),
    ...(data.availabilityRuleJson !== undefined && { availabilityRuleJson: data.availabilityRuleJson }),
    ...(data.minSellingPrice !== undefined && { minSellingPrice: data.minSellingPrice }),
    ...(data.maxDiscountPct !== undefined && { maxDiscountPct: data.maxDiscountPct }),
    ...(data.maxDiscountAmount !== undefined && { maxDiscountAmount: data.maxDiscountAmount }),
    ...(data.taxApplicable !== undefined && { taxApplicable: data.taxApplicable }),
    ...(data.branchOverrideAllowed !== undefined && { branchOverrideAllowed: data.branchOverrideAllowed }),
    ...(data.description !== undefined && { description: data.description }),
    ...(data.publicDescription !== undefined && { publicDescription: data.publicDescription }),
    ...(data.internalNotes !== undefined && { internalNotes: data.internalNotes }),
    ...(data.department !== undefined && { department: data.department }),
    ...(data.breedNote !== undefined && { breedNote: data.breedNote }),
    ...(data.updatedByUserId !== undefined && { updatedByUserId: data.updatedByUserId }),
    ...(data.effectiveFrom !== undefined && { effectiveFrom: data.effectiveFrom }),
    ...(data.effectiveTo !== undefined && { effectiveTo: data.effectiveTo }),
    ...(data.serviceId != null && { serviceId: data.serviceId }),
  };

  const pkg = await prisma.surgeryPackage.update({
    where: { id: packageId },
    data: updateData,
    include: { service: { select: { id: true, name: true } } },
  });

  const auditMeta: Record<string, unknown> = {};
  if (data.status != null && data.status !== existing.status) auditMeta.statusChange = { from: existing.status, to: data.status };
  if (data.baseSellingPrice != null && Number(data.baseSellingPrice) !== Number(existing.baseSellingPrice)) {
    auditMeta.priceChange = { from: Number(existing.baseSellingPrice), to: data.baseSellingPrice };
  }
  await logPackageAudit(packageId, "UPDATE", {
    userId: data.updatedByUserId ?? undefined,
    meta: Object.keys(auditMeta).length > 0 ? auditMeta : undefined,
  });

  return pkg;
}

/** Soft-delete: set status to INACTIVE */
export async function deletePackage(packageId: number, branchId: number) {
  const existing = await prisma.surgeryPackage.findFirst({
    where: { id: packageId, branchId },
  });
  if (!existing) throw new Error("Surgery package not found");
  await prisma.surgeryPackage.update({
    where: { id: packageId },
    data: { status: "INACTIVE" },
  });
  return { ok: true };
}

/** List package items for a package */
export async function listPackageItems(packageId: number, branchId: number) {
  const pkg = await prisma.surgeryPackage.findFirst({
    where: { id: packageId, branchId },
    select: { id: true },
  });
  if (!pkg) throw new Error("Surgery package not found");

  const items = await prisma.packageItem.findMany({
    where: { surgeryPackageId: packageId },
    include: {
      product: { select: { id: true, name: true } },
      variant: { select: { id: true, sku: true, title: true } },
      clinicalItem: { select: { id: true, name: true, itemCode: true } },
      clinicalItemVariant: { select: { id: true, variantName: true, sku: true } },
    },
    orderBy: { sortOrder: "asc" },
  });
  return items;
}

/** Add or update package item */
export async function upsertPackageItem(
  packageId: number,
  branchId: number,
  data: {
    id?: number;
    itemType: PackageItemType;
    productId?: number | null;
    variantId?: number | null;
    clinicalItemId?: number | null;
    clinicalItemVariantId?: number | null;
    estimatedQty?: number | null;
    estimatedCost?: number | null;
    displayLabel?: string | null;
    sortOrder?: number;
  }
) {
  const pkg = await prisma.surgeryPackage.findFirst({
    where: { id: packageId, branchId },
    select: { id: true },
  });
  if (!pkg) throw new Error("Surgery package not found");

  const itemType = data.itemType != null ? String(data.itemType).toUpperCase() : "INCLUDED";
  if (!VALID_PACKAGE_ITEM_TYPES.includes(itemType as PackageItemType)) {
    throw new Error(
      `Invalid itemType: must be one of ${VALID_PACKAGE_ITEM_TYPES.join(", ")}`
    );
  }

  const hasClinical = data.clinicalItemId != null && Number(data.clinicalItemId) > 0;
  const hasProduct = data.productId != null && Number(data.productId) > 0;
  const isCreate = data.id == null;
  if (isCreate && !hasClinical && !hasProduct) {
    throw new Error(
      "At least one item source is required: select a clinical item from search or provide product (and variant) for inventory item"
    );
  }

  const estimatedQtyNum = data.estimatedQty != null ? Number(data.estimatedQty) : undefined;
  const estimatedCostNum = data.estimatedCost != null ? Number(data.estimatedCost) : undefined;
  if (estimatedQtyNum != null && (Number.isNaN(estimatedQtyNum) || estimatedQtyNum <= 0)) {
    throw new Error("estimatedQty must be a positive number when provided");
  }
  if (estimatedCostNum != null && (Number.isNaN(estimatedCostNum) || estimatedCostNum < 0)) {
    throw new Error("estimatedCost must be zero or a positive number when provided");
  }

  const itemPayload = {
    itemType: itemType as PackageItemType,
    productId: data.productId ?? undefined,
    variantId: data.variantId ?? undefined,
    clinicalItemId: data.clinicalItemId ?? undefined,
    clinicalItemVariantId: data.clinicalItemVariantId ?? undefined,
    estimatedQty: data.estimatedQty ?? undefined,
    estimatedCost: data.estimatedCost ?? undefined,
    displayLabel: data.displayLabel ?? undefined,
    sortOrder: data.sortOrder ?? 0,
  };

  if (data.id != null) {
    const item = await prisma.packageItem.update({
      where: { id: data.id },
      data: itemPayload,
    });
    return item;
  }

  const item = await prisma.packageItem.create({
    data: {
      surgeryPackageId: packageId,
      ...itemPayload,
    },
  });
  await logPackageAudit(packageId, "ITEM_ADD", { meta: { itemId: item.id, itemType: item.itemType } });
  return item;
}

/** Batch create package items (non-breaking; single audit entry) */
export type PackageItemBatchRow = {
  itemType: PackageItemType;
  productId?: number | null;
  variantId?: number | null;
  clinicalItemId?: number | null;
  clinicalItemVariantId?: number | null;
  estimatedQty?: number | null;
  estimatedCost?: number | null;
  displayLabel?: string | null;
  sortOrder?: number;
};

export async function createPackageItemsBatch(
  packageId: number,
  branchId: number,
  rows: PackageItemBatchRow[]
): Promise<{ created: number; items: Awaited<ReturnType<typeof listPackageItems>> }> {
  const pkg = await prisma.surgeryPackage.findFirst({
    where: { id: packageId, branchId },
    select: { id: true },
  });
  if (!pkg) throw new Error("Surgery package not found");

  if (!Array.isArray(rows) || rows.length === 0) {
    return { created: 0, items: await listPackageItems(packageId, branchId) };
  }

  const nextOrder =
    (await prisma.packageItem.findFirst({
      where: { surgeryPackageId: packageId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    }))?.sortOrder ?? -1;

  const toCreate: Array<{
    surgeryPackageId: number;
    itemType: PackageItemType;
    productId?: number | null;
    variantId?: number | null;
    clinicalItemId?: number | null;
    clinicalItemVariantId?: number | null;
    estimatedQty?: number | null;
    estimatedCost?: number | null;
    displayLabel?: string | null;
    sortOrder: number;
  }> = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const itemType =
      r.itemType != null && VALID_PACKAGE_ITEM_TYPES.includes(String(r.itemType).toUpperCase() as PackageItemType)
        ? (String(r.itemType).toUpperCase() as PackageItemType)
        : "INCLUDED";

    const hasClinical = r.clinicalItemId != null && Number(r.clinicalItemId) > 0;
    const hasProduct = r.productId != null && Number(r.productId) > 0;
    if (!hasClinical && !hasProduct) continue;

    const estimatedQtyNum = r.estimatedQty != null ? Number(r.estimatedQty) : undefined;
    const estimatedCostNum = r.estimatedCost != null ? Number(r.estimatedCost) : undefined;
    if (estimatedQtyNum != null && (Number.isNaN(estimatedQtyNum) || estimatedQtyNum <= 0)) continue;
    if (estimatedCostNum != null && (Number.isNaN(estimatedCostNum) || estimatedCostNum < 0)) continue;

    toCreate.push({
      surgeryPackageId: packageId,
      itemType,
      productId: r.productId ?? undefined,
      variantId: r.variantId ?? undefined,
      clinicalItemId: r.clinicalItemId ?? undefined,
      clinicalItemVariantId: r.clinicalItemVariantId ?? undefined,
      estimatedQty: r.estimatedQty ?? undefined,
      estimatedCost: r.estimatedCost ?? undefined,
      displayLabel: r.displayLabel ?? undefined,
      sortOrder: typeof r.sortOrder === "number" && !Number.isNaN(r.sortOrder) ? r.sortOrder : nextOrder + 1 + i,
    });
  }

  if (toCreate.length === 0) {
    return { created: 0, items: await listPackageItems(packageId, branchId) };
  }

  await prisma.packageItem.createMany({ data: toCreate });
  if (toCreate.length > 0) {
    await logPackageAudit(packageId, "ITEM_ADD", { meta: { batchCount: toCreate.length } });
  }
  const items = await listPackageItems(packageId, branchId);
  return { created: toCreate.length, items };
}

/** Remove package item */
export async function deletePackageItem(
  packageId: number,
  itemId: number,
  branchId: number
) {
  const pkg = await prisma.surgeryPackage.findFirst({
    where: { id: packageId, branchId },
    select: { id: true },
  });
  if (!pkg) throw new Error("Surgery package not found");
  const deleted = await prisma.packageItem.deleteMany({
    where: { id: itemId, surgeryPackageId: packageId },
  });
  if (deleted.count > 0) {
    await logPackageAudit(packageId, "ITEM_REMOVE", { meta: { itemId } });
  }
  return { ok: true };
}

/** List price rules for a package */
export async function listPackagePriceRules(packageId: number, branchId: number) {
  const pkg = await prisma.surgeryPackage.findFirst({
    where: { id: packageId, branchId },
    select: { id: true },
  });
  if (!pkg) throw new Error("Surgery package not found");
  return prisma.packagePriceRule.findMany({
    where: { surgeryPackageId: packageId },
    include: { branch: { select: { id: true, name: true } } },
    orderBy: [{ isEmergency: "desc" }, { id: "asc" }],
  });
}

/** Add package price rule (accepts price or priceOverride) */
export async function createPackagePriceRule(
  packageId: number,
  branchId: number,
  data: {
    branchId?: number | null;
    species?: string | null;
    weightBandJson?: object | null;
    weightMin?: number | null;
    weightMax?: number | null;
    isEmergency?: boolean;
    price?: number;
    priceOverride?: number;
    validFrom?: Date | null;
    validTo?: Date | null;
  }
) {
  const pkg = await prisma.surgeryPackage.findFirst({
    where: { id: packageId, branchId },
    select: { id: true },
  });
  if (!pkg) throw new Error("Surgery package not found");

  const priceOverride = data.priceOverride ?? data.price;
  if (priceOverride == null || Number.isNaN(Number(priceOverride)))
    throw new Error("Price or priceOverride is required");

  const weightBandJson =
    data.weightBandJson ??
    (data.weightMin != null || data.weightMax != null
      ? { minKg: data.weightMin, maxKg: data.weightMax }
      : undefined);

  const rule = await prisma.packagePriceRule.create({
    data: {
      surgeryPackageId: packageId,
      branchId: data.branchId ?? undefined,
      species: data.species ?? undefined,
      weightBandJson: weightBandJson ?? undefined,
      isEmergency: data.isEmergency ?? false,
      priceOverride: Number(priceOverride),
      validFrom: data.validFrom ?? undefined,
      validTo: data.validTo ?? undefined,
    },
  });
  return rule;
}

/** Delete package price rule */
export async function deletePackagePriceRule(
  packageId: number,
  ruleId: number,
  branchId: number
) {
  const pkg = await prisma.surgeryPackage.findFirst({
    where: { id: packageId, branchId },
    select: { id: true },
  });
  if (!pkg) throw new Error("Surgery package not found");
  await prisma.packagePriceRule.deleteMany({
    where: { id: ruleId, surgeryPackageId: packageId },
  });
  return { ok: true };
}

/** Get available packages for a service (and optional species) for case creation */
export async function getAvailablePackagesForService(options: {
  branchId: number;
  serviceId: number;
  species?: string;
  isEmergency?: boolean;
}) {
  const { branchId, serviceId, species: speciesOpt, isEmergency } = options;
  const service = await prisma.service.findFirst({
    where: { id: serviceId, branchId },
    select: { id: true, name: true, packageAllowed: true },
  });
  if (!service) throw new Error("Service not found");
  if (!service.packageAllowed) return [];

  const now = new Date();
  const where: Record<string, unknown> = {
    branchId,
    serviceId,
    status: "ACTIVE",
    OR: [
      { validFrom: null, validTo: null },
      { validFrom: { lte: now }, validTo: null },
      { validFrom: null, validTo: { gte: now } },
      { validFrom: { lte: now }, validTo: { gte: now } },
    ],
  };

  const packages = await prisma.surgeryPackage.findMany({
    where,
    include: {
      service: { select: { id: true, name: true, category: true } },
      _count: { select: { items: true } },
    },
    orderBy: [{ packageType: "asc" }, { baseSellingPrice: "asc" }],
  });

  let filtered = packages;
  if (speciesOpt != null) {
    filtered = packages.filter((p) => {
      const cond = p.speciesCondition as string[] | { species?: string[] } | null;
      if (!cond) return true;
      if (Array.isArray(cond)) return cond.includes(speciesOpt);
      if (cond.species && Array.isArray(cond.species))
        return cond.species.includes(speciesOpt);
      return true;
    });
  }
  if (isEmergency === true) {
    filtered = filtered.filter((p) => p.packageType === "EMERGENCY" || p.packageType === "STANDARD");
  }

  return filtered.map((p) => ({
    id: p.id,
    packageCode: p.packageCode,
    packageName: p.packageName,
    packageType: p.packageType,
    baseSellingPrice: Number(p.baseSellingPrice),
    doctorFeeAmount: p.doctorFeeAmount != null ? Number(p.doctorFeeAmount) : null,
    clinicFeeAmount: p.clinicFeeAmount != null ? Number(p.clinicFeeAmount) : null,
    consumableBlockAmount:
      p.consumableBlockAmount != null ? Number(p.consumableBlockAmount) : null,
    medicationBlockAmount:
      p.medicationBlockAmount != null ? Number(p.medicationBlockAmount) : null,
    supportFeeAmount: p.supportFeeAmount != null ? Number(p.supportFeeAmount) : null,
    discountable: p.discountable,
    itemCount: (p as { _count?: { items: number } })._count?.items ?? 0,
  }));
}

/** Get package composition (breakdown) for display / billing */
export async function getPackageComposition(
  packageId: number,
  branchId: number
): Promise<{
  package: { id: number; code: string; name: string; type: string; basePrice: number };
  doctorFee: number;
  clinicFee: number;
  consumableBlock: number;
  medicationBlock: number;
  supportFee: number;
  estimatedCost: number;
  items: { type: string; label: string; qty: number | null; cost: number | null }[];
}> {
  const pkg = await prisma.surgeryPackage.findFirst({
    where: { id: packageId, branchId },
    include: {
      items: {
        include: {
          product: { select: { name: true } },
          variant: { select: { title: true } },
          clinicalItem: { select: { name: true } },
          clinicalItemVariant: { select: { variantName: true } },
        },
      },
    },
  });
  if (!pkg) throw new Error("Surgery package not found");

  const n = (v: unknown): number => (v != null ? Number(v) : 0);
  const doctorFee = n(pkg.doctorFeeAmount);
  const clinicFee = n(pkg.clinicFeeAmount);
  const consumableBlock = n(pkg.consumableBlockAmount);
  const medicationBlock = n(pkg.medicationBlockAmount);
  const supportFee = n(pkg.supportFeeAmount);
  const estimatedCost = n(pkg.estimatedCost);

  const items = pkg.items.map((i) => {
    const label =
      i.displayLabel ||
      (i.variant?.title ?? i.product?.name) ||
      (i.clinicalItemVariant?.variantName ?? i.clinicalItem?.name) ||
      `Item #${i.id}`;
    return {
      type: i.itemType,
      label,
      qty: i.estimatedQty != null ? Number(i.estimatedQty) : null,
      cost: i.estimatedCost != null ? Number(i.estimatedCost) : null,
    };
  });

  return {
    package: {
      id: pkg.id,
      code: pkg.packageCode,
      name: pkg.packageName,
      type: pkg.packageType,
      basePrice: Number(pkg.baseSellingPrice),
    },
    doctorFee,
    clinicFee,
    consumableBlock,
    medicationBlock,
    supportFee,
    estimatedCost,
    items,
  };
}

/** Log package audit entry */
export async function logPackageAudit(
  surgeryPackageId: number,
  action: string,
  options: { userId?: number | null; meta?: object | null }
) {
  await prisma.packageAuditLog.create({
    data: {
      surgeryPackageId,
      action,
      userId: options.userId ?? undefined,
      meta: options.meta ?? undefined,
    },
  });
}

/** Get package impact: appointments, cases, procedure orders, invoices, linked promotions */
export async function getPackageImpact(packageId: number, branchId: number) {
  const pkg = await prisma.surgeryPackage.findFirst({
    where: { id: packageId, branchId },
    select: { id: true, branchId: true },
  });
  if (!pkg) throw new Error("Surgery package not found");

  const now = new Date();
  const [clinicalCases, procedureOrders, clinicInvoices, appointmentsUpcoming] = await Promise.all([
    prisma.clinicalCase.count({ where: { surgeryPackageId: packageId } }),
    prisma.procedureOrder.count({ where: { surgeryPackageId: packageId } }),
    prisma.clinicInvoice.count({ where: { surgeryPackageId: packageId } }),
    prisma.appointment.count({
      where: {
        clinicalCase: { surgeryPackageId: packageId },
        scheduledStartAt: { gte: now },
        status: { not: AppointmentStatus.CANCELLED },
      },
    }),
  ]);

  const activeAppointments = await prisma.appointment.count({
    where: {
      clinicalCase: { surgeryPackageId: packageId },
      status: {
        in: [
          AppointmentStatus.BOOKED,
          AppointmentStatus.CONFIRMED,
          AppointmentStatus.CHECKED_IN,
          AppointmentStatus.IN_CONSULT,
        ],
      },
    },
  });

  return {
    activeAppointments,
    upcomingBookings: appointmentsUpcoming,
    clinicalCasesCount: clinicalCases,
    procedureOrdersCount: procedureOrders,
    clinicInvoicesCount: clinicInvoices,
    branchesWhereAvailable: 1,
    usedInSurgeryWorkflow: procedureOrders > 0,
  };
}

/** Get package audit log (and price change log) for history tab */
export async function getPackageAuditLog(
  packageId: number,
  branchId: number,
  options?: { limit?: number; offset?: number }
) {
  const pkg = await prisma.surgeryPackage.findFirst({
    where: { id: packageId, branchId },
    select: { id: true },
  });
  if (!pkg) throw new Error("Surgery package not found");

  const limit = Math.min(options?.limit ?? 50, 100);
  const offset = options?.offset ?? 0;

  const [auditRows, priceLogs] = await Promise.all([
    prisma.packageAuditLog.findMany({
      where: { surgeryPackageId: packageId },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        user: {
          include: {
            profile: { select: { displayName: true } },
            auth: { select: { email: true } },
          },
        },
      },
    }),
    prisma.packagePriceChangeLog.findMany({
      where: { surgeryPackageId: packageId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        changedBy: {
          include: {
            profile: { select: { displayName: true } },
            auth: { select: { email: true } },
          },
        },
      },
    }),
  ]);

  const mapUser = (u: { id: number; profile?: { displayName: string } | null; auth?: { email: string | null } | null } | null) =>
    u != null
      ? { id: u.id, name: u.profile?.displayName ?? u.auth?.email ?? null, email: u.auth?.email ?? null }
      : null;

  const auditEntries = auditRows.map((r) => ({
    id: `audit-${r.id}`,
    type: "audit",
    action: r.action,
    userId: r.userId,
    user: mapUser(r.user as Parameters<typeof mapUser>[0]),
    meta: r.meta,
    createdAt: r.createdAt,
  }));

  const priceEntries = priceLogs.map((r) => ({
    id: `price-${r.id}`,
    type: "price_change",
    action: "PRICE_CHANGE",
    userId: r.changedByUserId,
    user: mapUser(r.changedBy as Parameters<typeof mapUser>[0]),
    meta: {
      oldPrice: Number(r.oldPrice),
      newPrice: Number(r.newPrice),
      reason: r.reason,
    },
    createdAt: r.createdAt,
  }));

  const combined = [...auditEntries, ...priceEntries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return combined.slice(0, limit);
}

/** Duplicate package (creates copy as DRAFT in same branch) */
export async function duplicatePackage(
  packageId: number,
  branchId: number,
  options: { newPackageCode: string; userId?: number | null }
) {
  const existing = await prisma.surgeryPackage.findFirst({
    where: { id: packageId, branchId },
    include: {
      items: true,
      service: { select: { id: true } },
    },
  });
  if (!existing) throw new Error("Surgery package not found");

  const existingCode = await prisma.surgeryPackage.findUnique({
    where: { packageCode: options.newPackageCode.trim() },
    select: { id: true },
  });
  if (existingCode) throw new Error("Package code already exists");

  const pkg = await prisma.surgeryPackage.create({
    data: {
      orgId: existing.orgId,
      branchId: existing.branchId,
      serviceId: existing.serviceId,
      packageCode: options.newPackageCode.trim(),
      packageName: `${existing.packageName} (Copy)`,
      packageType: existing.packageType,
      baseSellingPrice: existing.baseSellingPrice,
      validFrom: existing.validFrom,
      validTo: existing.validTo,
      doctorFeeAmount: existing.doctorFeeAmount,
      clinicFeeAmount: existing.clinicFeeAmount,
      consumableBlockAmount: existing.consumableBlockAmount,
      medicationBlockAmount: existing.medicationBlockAmount,
      supportFeeAmount: existing.supportFeeAmount,
      estimatedCost: existing.estimatedCost,
      emergencySurchargeRule: existing.emergencySurchargeRule,
      addOnAllowed: existing.addOnAllowed,
      discountable: existing.discountable,
      speciesCondition: existing.speciesCondition,
      status: "DRAFT",
      eligibilityRuleJson: existing.eligibilityRuleJson,
      availabilityRuleJson: existing.availabilityRuleJson,
      minSellingPrice: existing.minSellingPrice,
      maxDiscountPct: existing.maxDiscountPct,
      maxDiscountAmount: existing.maxDiscountAmount,
      taxApplicable: existing.taxApplicable ?? false,
      branchOverrideAllowed: existing.branchOverrideAllowed ?? false,
      description: existing.description,
      publicDescription: existing.publicDescription,
      internalNotes: existing.internalNotes,
      department: existing.department,
      breedNote: existing.breedNote,
    },
    include: { service: { select: { id: true, name: true } } },
  });

  const itemData = existing.items.map((i) => ({
    surgeryPackageId: pkg.id,
    itemType: i.itemType,
    productId: i.productId,
    variantId: i.variantId,
    clinicalItemId: i.clinicalItemId,
    clinicalItemVariantId: i.clinicalItemVariantId,
    estimatedQty: i.estimatedQty,
    estimatedCost: i.estimatedCost,
    displayLabel: i.displayLabel,
    sortOrder: i.sortOrder,
  }));
  if (itemData.length > 0) {
    await prisma.packageItem.createMany({ data: itemData });
  }

  await logPackageAudit(pkg.id, "CREATE", {
    userId: options.userId,
    meta: { duplicatedFromPackageId: packageId },
  });

  return prisma.surgeryPackage.findUnique({
    where: { id: pkg.id },
    include: {
      service: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
  });
}
