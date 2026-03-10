/**
 * Instrument instance: serial-tracked or countable instrument units per branch.
 * Tracks condition, sterilization status, usage count, and lifecycle.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");

const CONDITION_STATUSES = ["GOOD", "NEEDS_MAINTENANCE", "DAMAGED", "RETIRED"] as const;
const STERILIZATION_STATUSES = [
  "STERILE",
  "USED",
  "DIRTY",
  "IN_STERILIZATION",
  "EXPIRED",
  "NOT_APPLICABLE",
] as const;

/** List instrument instances for a branch. */
export async function listInstrumentInstances(
  branchId: number,
  options?: { clinicalItemId?: number; sterilizationStatus?: string; activeOnly?: boolean }
) {
  const where: Record<string, unknown> = { branchId };
  if (options?.clinicalItemId != null) where.clinicalItemId = options.clinicalItemId;
  if (options?.sterilizationStatus != null) where.sterilizationStatus = options.sterilizationStatus;
  if (options?.activeOnly !== false) where.active = true;

  const items = await prisma.instrumentInstance.findMany({
    where,
    include: {
      clinicalItem: { select: { id: true, name: true, itemCode: true } },
    },
    orderBy: [{ clinicalItemId: "asc" }, { id: "asc" }],
    take: 500,
  });
  return items;
}

/** Get one instrument instance by id. */
export async function getInstrumentInstanceById(instanceId: number, scope?: { branchId?: number }) {
  const where: Record<string, unknown> = { id: instanceId };
  if (scope?.branchId != null) where.branchId = scope.branchId;
  return prisma.instrumentInstance.findFirst({
    where,
    include: {
      clinicalItem: { select: { id: true, name: true, itemCode: true } },
      branch: { select: { id: true, name: true } },
    },
  });
}

/** Create an instrument instance (e.g. new serial-tracked instrument received). */
export async function createInstrumentInstance(
  branchId: number,
  data: {
    clinicalItemId: number;
    serialNo?: string | null;
    conditionStatus?: string;
    sterilizationStatus?: string;
    purchasedAt?: string | null;
  }
) {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { orgId: true },
  });
  if (!branch) throw new Error("Branch not found");

  const conditionStatus = (data.conditionStatus ?? "GOOD").toUpperCase();
  const sterilizationStatus = (data.sterilizationStatus ?? "NOT_APPLICABLE").toUpperCase();
  if (!CONDITION_STATUSES.includes(conditionStatus as any))
    throw new Error("Invalid conditionStatus");
  if (!STERILIZATION_STATUSES.includes(sterilizationStatus as any))
    throw new Error("Invalid sterilizationStatus");

  const purchasedAt = data.purchasedAt ? new Date(data.purchasedAt) : undefined;
  return prisma.instrumentInstance.create({
    data: {
      orgId: branch.orgId,
      branchId,
      clinicalItemId: data.clinicalItemId,
      serialNo: data.serialNo ?? undefined,
      conditionStatus,
      sterilizationStatus,
      purchasedAt,
    },
    include: {
      clinicalItem: { select: { id: true, name: true, itemCode: true } },
    },
  });
}

/** Update an instrument instance (condition, retire, etc.). */
export async function updateInstrumentInstance(
  instanceId: number,
  scope: { branchId: number },
  data: {
    serialNo?: string | null;
    conditionStatus?: string;
    sterilizationStatus?: string;
    active?: boolean;
  }
) {
  const existing = await prisma.instrumentInstance.findFirst({
    where: { id: instanceId, branchId: scope.branchId },
  });
  if (!existing) throw new Error("Instrument instance not found");

  const update: Record<string, unknown> = {};
  if (data.serialNo !== undefined) update.serialNo = data.serialNo;
  if (data.conditionStatus !== undefined) {
    const v = data.conditionStatus.toUpperCase();
    if (!CONDITION_STATUSES.includes(v as any)) throw new Error("Invalid conditionStatus");
    update.conditionStatus = v;
  }
  if (data.sterilizationStatus !== undefined) {
    const v = data.sterilizationStatus.toUpperCase();
    if (!STERILIZATION_STATUSES.includes(v as any)) throw new Error("Invalid sterilizationStatus");
    update.sterilizationStatus = v;
  }
  if (data.active !== undefined) update.active = data.active;

  return prisma.instrumentInstance.update({
    where: { id: instanceId },
    data: update,
    include: {
      clinicalItem: { select: { id: true, name: true, itemCode: true } },
    },
  });
}

/** Record instrument usage (e.g. used in surgery). Marks sterilization status USED and increments usageCount. */
export async function recordInstrumentUsage(instanceId: number, options?: { surgeryId?: number }) {
  const instance = await prisma.instrumentInstance.findUnique({
    where: { id: instanceId },
  });
  if (!instance) throw new Error("Instrument instance not found");

  return prisma.instrumentInstance.update({
    where: { id: instanceId },
    data: {
      sterilizationStatus: "USED",
      usageCount: { increment: 1 },
    },
    include: {
      clinicalItem: { select: { id: true, name: true } },
    },
  });
}

/** Get instruments due for sterilization (expired or used). Used for dashboard alerts. */
export async function getDueSterilizationAlerts(branchId: number) {
  const now = new Date();
  const items = await prisma.instrumentInstance.findMany({
    where: {
      branchId,
      active: true,
      OR: [
        { sterilizationStatus: "USED" },
        { sterilizationStatus: "EXPIRED" },
        { sterilizationExpiryAt: { lt: now }, sterilizationStatus: "STERILE" },
      ],
    },
    include: {
      clinicalItem: { select: { id: true, name: true, itemCode: true } },
    },
    orderBy: [{ sterilizationExpiryAt: "asc" }, { id: "asc" }],
    take: 100,
  });
  return items;
}

/** Get instrument status summary for branch (counts by status). */
export async function getInstrumentStatus(branchId: number) {
  const instances = await prisma.instrumentInstance.findMany({
    where: { branchId, active: true },
    select: {
      id: true,
      clinicalItemId: true,
      serialNo: true,
      conditionStatus: true,
      sterilizationStatus: true,
      lastSterilizedAt: true,
      sterilizationExpiryAt: true,
      usageCount: true,
      clinicalItem: { select: { id: true, name: true, itemCode: true } },
    },
  });
  return instances;
}
