/**
 * Sterilization cycle: track instrument sterilization batches (autoclave, chemical, etc.).
 * Start cycle -> mark instrument instances IN_STERILIZATION; complete -> STERILE + expiry.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");

const STERILIZATION_METHODS = ["AUTOCLAVE", "CHEMICAL", "DRY_HEAT", "ETHYLENE_OXIDE"] as const;
const DEFAULT_STERILE_DAYS = 7;

async function generateCycleNo(branchId: number): Promise<string> {
  const count = await prisma.sterilizationCycle.count({
    where: { branchId },
  });
  const pad = String(count + 1).padStart(5, "0");
  return `SC-${branchId}-${pad}-${Date.now().toString(36).toUpperCase()}`;
}

/** Start a sterilization cycle. instrumentIds = ClinicalItem ids (instrument types in this batch). */
export async function startSterilizationCycle(
  branchId: number,
  instrumentIds: number[],
  method: string,
  options?: { machineName?: string; operatorId: number }
) {
  if (!instrumentIds.length) throw new Error("At least one instrument is required");
  const m = method?.toUpperCase();
  if (!STERILIZATION_METHODS.includes(m as any)) throw new Error("Invalid sterilization method");

  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { orgId: true },
  });
  if (!branch) throw new Error("Branch not found");
  const operatorId = options?.operatorId;
  if (!operatorId) throw new Error("operatorId is required");

  const cycleNo = await generateCycleNo(branchId);
  const cycle = await prisma.sterilizationCycle.create({
    data: {
      orgId: branch.orgId,
      branchId,
      cycleNo,
      method: m,
      machineName: options?.machineName ?? undefined,
      operatorId,
      status: "IN_PROGRESS",
      items: {
        create: instrumentIds.map((instrumentId) => ({
          instrumentId,
          preCleanStatus: "CLEAN",
        })),
      },
    },
    include: {
      items: { include: { instrument: { select: { id: true, name: true } } } },
      operator: { select: { id: true } },
    },
  });

  await prisma.instrumentInstance.updateMany({
    where: { branchId, clinicalItemId: { in: instrumentIds }, active: true },
    data: { sterilizationStatus: "IN_STERILIZATION" },
  });

  return cycle;
}

/** Complete a sterilization cycle. Marks instrument instances STERILE and sets expiry. */
export async function completeSterilizationCycle(
  cycleId: number,
  options?: { sterileDays?: number }
) {
  const cycle = await prisma.sterilizationCycle.findFirst({
    where: { id: cycleId },
    include: { items: true },
  });
  if (!cycle) throw new Error("Sterilization cycle not found");
  if (cycle.status !== "IN_PROGRESS") throw new Error("Cycle is not in progress");

  const sterileDays = options?.sterileDays ?? DEFAULT_STERILE_DAYS;
  const completedAt = new Date();
  const sterilizationExpiryAt = new Date(completedAt);
  sterilizationExpiryAt.setDate(sterilizationExpiryAt.getDate() + sterileDays);

  const instrumentIds = cycle.items.map((i) => i.instrumentId);

  await prisma.$transaction([
    prisma.sterilizationCycle.update({
      where: { id: cycleId },
      data: { status: "COMPLETED", completedAt },
    }),
    prisma.sterilizationCycleItem.updateMany({
      where: { cycleId },
      data: { postCycleStatus: "STERILE" },
    }),
    prisma.instrumentInstance.updateMany({
      where: { branchId: cycle.branchId, clinicalItemId: { in: instrumentIds }, active: true },
      data: {
        sterilizationStatus: "STERILE",
        lastSterilizedAt: completedAt,
        sterilizationExpiryAt,
      },
    }),
  ]);

  return prisma.sterilizationCycle.findUnique({
    where: { id: cycleId },
    include: {
      items: { include: { instrument: { select: { id: true, name: true } } } },
      operator: { select: { id: true } },
    },
  });
}

/** Mark cycle as failed (e.g. biological indicator positive). */
export async function failSterilizationCycle(cycleId: number) {
  const cycle = await prisma.sterilizationCycle.findFirst({
    where: { id: cycleId },
    include: { items: true },
  });
  if (!cycle) throw new Error("Sterilization cycle not found");
  if (cycle.status !== "IN_PROGRESS") throw new Error("Cycle is not in progress");

  const instrumentIds = cycle.items.map((i) => i.instrumentId);
  await prisma.$transaction([
    prisma.sterilizationCycle.update({
      where: { id: cycleId },
      data: { status: "FAILED", completedAt: new Date() },
    }),
    prisma.sterilizationCycleItem.updateMany({
      where: { cycleId },
      data: { postCycleStatus: "FAILED" },
    }),
    prisma.instrumentInstance.updateMany({
      where: { branchId: cycle.branchId, clinicalItemId: { in: instrumentIds }, active: true },
      data: { sterilizationStatus: "DIRTY" },
    }),
  ]);
  return prisma.sterilizationCycle.findUnique({
    where: { id: cycleId },
    include: { items: { include: { instrument: { select: { id: true, name: true } } } } },
  });
}

/** List cycles for a branch. */
export async function getSterilizationCycles(branchId: number, options?: { status?: string; limit?: number; offset?: number }) {
  const where: Record<string, unknown> = { branchId };
  if (options?.status) where.status = options.status;
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  const [items, total] = await Promise.all([
    prisma.sterilizationCycle.findMany({
      where,
      include: {
        items: { include: { instrument: { select: { id: true, name: true } } } },
        operator: { select: { id: true } },
      },
      orderBy: { startedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.sterilizationCycle.count({ where }),
  ]);
  return { items, total };
}

/** Get one cycle by id. */
export async function getSterilizationCycleById(cycleId: number, scope?: { branchId?: number }) {
  const where: Record<string, unknown> = { id: cycleId };
  if (scope?.branchId != null) where.branchId = scope.branchId;
  return prisma.sterilizationCycle.findFirst({
    where,
    include: {
      items: { include: { instrument: { select: { id: true, name: true, itemCode: true } } } },
      operator: { select: { id: true } },
      branch: { select: { id: true, name: true } },
    },
  });
}
