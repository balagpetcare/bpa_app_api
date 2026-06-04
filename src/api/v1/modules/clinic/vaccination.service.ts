/**
 * Vaccination & preventive care: record vaccination, booster schedule, certificate (QR), deworming.
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
const { randomUUID } = require("crypto");
const { recordClinicalLedgerEntry } = require("./clinicalStockLedger.service");
const billingService = require("./billing.service");

function generateCertificateToken(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();
}

function createHttpError(message: string, statusCode: number = 400): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function normalizeText(value: any): string {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

function toSlugLike(value: any): string {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function isExpiredBatch(expiryDate: Date | null | undefined): boolean {
  if (!expiryDate) return false;
  const todayStart = startOfDay(new Date());
  const batchDate = startOfDay(expiryDate);
  return batchDate < todayStart;
}

function toSafeNumber(value: any): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function branchScopedPetWhere(branchId: number): any {
  return {
    deleted: false,
    OR: [
      { clinicRegisteredBranchId: branchId },
      { appointments: { some: { branchId } } },
      { visits: { some: { branchId } } },
    ],
  };
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

const VACCINE_ITEM_TERMS = ["vaccine", "vaccines", "vaccination", "immun", "rabies", "dhpp", "dhlpp", "fvr", "feline"];
const REMINDER_STAGE_OFFSETS: Array<{ stage: "SEVEN_DAYS_BEFORE" | "THREE_DAYS_BEFORE" | "DUE_DATE" | "OVERDUE"; days: number }> = [
  { stage: "SEVEN_DAYS_BEFORE", days: -7 },
  { stage: "THREE_DAYS_BEFORE", days: -3 },
  { stage: "DUE_DATE", days: 0 },
  { stage: "OVERDUE", days: 1 },
];

function addDays(base: Date, days: number): Date {
  const out = new Date(base);
  out.setDate(out.getDate() + days);
  return out;
}

function buildVaccinationReminderIdempotencyKey(vaccinationId: number, stage: string, dueDate: Date, channel: string): string {
  const due = startOfDay(dueDate).toISOString().slice(0, 10);
  return `vaccination:${vaccinationId}:stage:${stage}:due:${due}:channel:${channel}`;
}

function normalizeVaccinationRecord(record: any): any {
  if (!record) return record;
  return {
    ...record,
    status: record.status || "ACTIVE",
    legacyRecord: record.branchId == null,
  };
}

function isVaccineLikeClinicalItem(item: any): boolean {
  if (!item) return false;
  const itemNameNormalized = normalizeText(item.name);
  const itemSlug = toSlugLike(item.slug || item.name);
  const categoryNameNormalized = normalizeText(item.category?.name);
  return (
    String(item.domainType || "").toUpperCase() === "MEDICINE" &&
    item.isInventoryTracked === true &&
    (VACCINE_ITEM_TERMS.some((term) => itemNameNormalized.includes(term) || itemSlug.includes(term)) ||
      categoryNameNormalized.includes("vaccin") ||
      String(item.itemCode || "").toUpperCase().startsWith("VAC"))
  );
}

function buildVaccineLikeItemWhere(orgId: number): any {
  return {
    orgId,
    isActive: true,
    isInventoryTracked: true,
    domainType: "MEDICINE",
    OR: [
      { requiresBatch: true },
      { requiresExpiry: true },
      { name: { contains: "vaccine", mode: "insensitive" } },
      { name: { contains: "vaccination", mode: "insensitive" } },
      { itemCode: { startsWith: "VAC" } },
      { category: { name: { contains: "vaccin", mode: "insensitive" } } },
    ],
  };
}

function getInventoryMappingStatus(mapping: any, orgId: number): "MAPPED" | "UNMAPPED" | "INVALID_ITEM" | "INACTIVE" {
  if (!mapping) return "UNMAPPED";
  if (mapping.isActive !== true) return "INACTIVE";
  const item = mapping.clinicalItem;
  if (
    !item ||
    Number(item.orgId) !== Number(orgId) ||
    item.isActive !== true ||
    item.isInventoryTracked !== true ||
    String(item.domainType || "").toUpperCase() !== "MEDICINE" ||
    !isVaccineLikeClinicalItem(item)
  ) {
    return "INVALID_ITEM";
  }
  if (mapping.clinicalItemVariantId != null) {
    const variant = mapping.clinicalItemVariant;
    if (!variant || Number(variant.itemId) !== Number(item.id) || variant.isActive !== true) {
      return "INVALID_ITEM";
    }
  }
  return "MAPPED";
}

function mapBranchBatchCandidate(batch: any, stock: any, matchStrategy: string) {
  return {
    batchId: batch.id,
    itemId: batch.itemId,
    variantId: batch.variantId,
    itemName: batch.item?.name ?? null,
    itemCode: batch.item?.itemCode ?? null,
    variantName: batch.variant?.variantName ?? null,
    sku: batch.variant?.sku ?? null,
    manufacturerName: batch.item?.manufacturerName ?? null,
    batchNo: batch.batchNo,
    expiryDate: batch.expiryDate,
    remainingQty: toSafeNumber(batch.remainingQty),
    availableQty: stock ? toSafeNumber(stock.availableQty) : toSafeNumber(batch.remainingQty),
    status: batch.status,
    isExpired: isExpiredBatch(batch.expiryDate),
    isLowStock:
      stock?.reorderLevel != null
        ? toSafeNumber(stock.availableQty) <= toSafeNumber(stock.reorderLevel)
        : false,
    matchStrategy,
  };
}

function buildCandidateDebug(payload: Record<string, unknown>): any {
  return process.env.NODE_ENV !== "production" ? payload : undefined;
}

function sortBranchBatchCandidates(items: any[], limit: number): any[] {
  return items
    .slice()
    .sort((a: any, b: any) => {
      const aExpiry = a.expiryDate ? new Date(a.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
      const bExpiry = b.expiryDate ? new Date(b.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
      if (aExpiry !== bExpiry) return aExpiry - bExpiry;
      return toSafeNumber(b.remainingQty) - toSafeNumber(a.remainingQty);
    })
    .slice(0, limit);
}

function rankVaccineItemMatch(item: any, variant: any, normalizedVaccineName: string, vaccineSlug: string): { rank: number; strategy: string } {
  const itemNameNormalized = normalizeText(item?.name);
  const itemSlug = toSlugLike(item?.slug || item?.name);
  const variantNameNormalized = normalizeText(variant?.variantName);
  const combinedNormalized = normalizeText(`${item?.name || ""} ${variant?.variantName || ""}`);
  const categoryNameNormalized = normalizeText(item?.category?.name);
  const itemLooksVaccineLike =
    VACCINE_ITEM_TERMS.some((term) => itemNameNormalized.includes(term) || combinedNormalized.includes(term)) ||
    categoryNameNormalized.includes("vaccin") ||
    String(item?.itemCode || "").toUpperCase().startsWith("VAC");

  if (itemNameNormalized === normalizedVaccineName) return { rank: 1, strategy: "exact-name" };
  if (variantNameNormalized === normalizedVaccineName) return { rank: 2, strategy: "exact-variant-name" };
  if (itemSlug === vaccineSlug) return { rank: 3, strategy: "slug" };
  if (
    normalizedVaccineName &&
    itemLooksVaccineLike &&
    (itemNameNormalized.includes(normalizedVaccineName) ||
      normalizedVaccineName.includes(itemNameNormalized) ||
      combinedNormalized.includes(normalizedVaccineName))
  ) {
    return { rank: 4, strategy: "restricted-contains" };
  }

  return { rank: 999, strategy: "none" };
}

async function fetchActiveVaccineInventoryMapping(orgId: number, vaccineTypeId: number): Promise<any | null> {
  return prisma.vaccineInventoryMapping.findUnique({
    where: { orgId_vaccineTypeId: { orgId: Number(orgId), vaccineTypeId: Number(vaccineTypeId) } },
    include: {
      clinicalItem: {
        select: {
          id: true,
          orgId: true,
          itemCode: true,
          name: true,
          slug: true,
          domainType: true,
          isActive: true,
          isInventoryTracked: true,
          requiresBatch: true,
          requiresExpiry: true,
          manufacturerName: true,
          category: { select: { id: true, name: true } },
        },
      },
      clinicalItemVariant: {
        select: {
          id: true,
          itemId: true,
          variantName: true,
          sku: true,
          isActive: true,
        },
      },
    },
  });
}

function buildVaccinationVisibilityWhere(branchId: number, vaccinationId: number): any {
  return {
    id: vaccinationId,
    OR: [
      { branchId },
      {
        branchId: null,
        pet: branchScopedPetWhere(branchId),
      },
    ],
  };
}

function getAuditActorRole(value: any): string {
  const normalized = String(value ?? "STAFF").trim().toUpperCase();
  return normalized || "STAFF";
}

function serializeAuditValue(value: any): any {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => serializeAuditValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, innerValue]) => [key, serializeAuditValue(innerValue)])
    );
  }
  return value;
}

async function writeVaccinationAuditEvent(
  db: any,
  opts: {
    actionKey: string;
    vaccination: any;
    actorUserId?: number | null;
    actorRole?: string | null;
    traceId?: string | null;
    ip?: string | null;
    metadata?: Record<string, unknown> | null;
  }
): Promise<void> {
  if (!db?.auditEvent?.create || !opts?.vaccination?.id) return;
  await db.auditEvent.create({
    data: {
      actorUserId: opts.actorUserId ?? undefined,
      actorRole: getAuditActorRole(opts.actorRole).slice(0, 64),
      actionKey: String(opts.actionKey || "VACCINATION_EVENT").slice(0, 128),
      entityType: "VACCINATION",
      entityId: String(opts.vaccination.id).slice(0, 128),
      orgId: opts.vaccination.orgId ?? undefined,
      metadata: serializeAuditValue({
        branchId: opts.vaccination.branchId ?? null,
        petId: opts.vaccination.petId ?? null,
        vaccineTypeId: opts.vaccination.vaccineTypeId ?? null,
        status: opts.vaccination.status ?? "ACTIVE",
        inventoryBatchId: opts.vaccination.inventoryBatchId ?? null,
        stockLedgerId: opts.vaccination.stockLedgerId ?? null,
        orderId: opts.vaccination.orderId ?? null,
        invoiceId: opts.vaccination.invoiceId ?? null,
        ...(opts.metadata || {}),
      }),
      traceId: opts.traceId ? String(opts.traceId).slice(0, 128) : null,
      ip: opts.ip ? String(opts.ip).slice(0, 64) : null,
    },
  });
}

function buildVaccinationWarnings(record: any): string[] {
  const warnings: string[] = [];
  if (!record) return warnings;
  if (record.branchId == null) {
    warnings.push("Legacy/manual vaccination record. Branch linkage is inferred from pet visibility.");
  }
  if (record.stockLedgerId != null) {
    warnings.push(
      record.status === "VOIDED"
        ? "Stock deduction remains linked. Stock reversal is not included in this phase."
        : "Stock-backed record. Inventory linkage cannot be changed through the correction API."
    );
  }
  if (record.orderId != null || record.invoiceId != null) {
    warnings.push(
      record.status === "VOIDED"
        ? "Billing linkage remains in place. Billing cancellation/refund is not included in this phase."
        : "Billing-linked record. Billing linkage cannot be changed through the correction API."
    );
  }
  return warnings;
}

function buildVaccinationWarningObject(record: any): any {
  const stockPending = record?.stockLedgerId != null;
  const billingPending = record?.orderId != null || record?.invoiceId != null;
  return {
    stock: {
      reversalRequired: stockPending,
      message: stockPending
        ? "Stock has not been reversed automatically in this phase."
        : "No stock reversal pending.",
      items: stockPending ? ["Stock deduction remains linked. Stock reversal is not included in this phase."] : [],
    },
    billing: {
      actionRequired: billingPending,
      orderId: record?.orderId ?? null,
      invoiceId: record?.invoiceId ?? null,
      message: billingPending
        ? "Billing has not been cancelled/refunded automatically in this phase."
        : "No billing cancellation/refund pending.",
      items: billingPending ? ["Billing linkage remains in place. Billing cancellation/refund is not included in this phase."] : [],
    },
    reminder: {
      cancelledOrSynced: true,
      message: "Reminder rows were synced/cancelled according to current vaccination state.",
      items: [],
    },
  };
}

function normalizeVaccinationAuditEventType(actionKey: any): string {
  const normalized = String(actionKey || "").trim().toUpperCase();
  if (!normalized) return "VACCINATION_EVENT";
  const aliases: Record<string, string> = {
    VACCINATION_BILLING_CREATED: "VACCINATION_BILLED",
  };
  return aliases[normalized] || normalized;
}

function mapAuditEventRow(row: any): any {
  return {
    id: row.id,
    eventType: normalizeVaccinationAuditEventType(row.actionKey),
    eventKeyRaw: row.actionKey ?? null,
    actorUserId: row.actorUserId ?? null,
    actorRole: row.actorRole ?? null,
    entityType: row.entityType ?? null,
    entityId: row.entityId ?? null,
    orgId: row.orgId ?? null,
    metadata: row.metadata ?? {},
    traceId: row.traceId ?? null,
    ip: row.ip ?? null,
    createdAt: row.createdAt ?? null,
  };
}

async function buildAdministerReplayPayload(record: any, opts: { requestedBilling?: boolean; idempotencyKey?: string | null } = {}): Promise<any> {
  const vaccination = normalizeVaccinationRecord(record);

  let remainingQty = 0;
  if (vaccination?.inventoryBatchId != null) {
    const batch = await prisma.branchItemBatch.findUnique({
      where: { id: Number(vaccination.inventoryBatchId) },
      select: { remainingQty: true },
    }).catch(() => null);
    remainingQty = batch ? toSafeNumber(batch.remainingQty) : 0;
  }

  let billing = {
    status: opts.requestedBilling === true ? "FAILED" : "SKIPPED",
    orderId: vaccination?.orderId ?? null,
    invoiceId: vaccination?.invoiceId ?? null,
    amount: null as number | null,
    message:
      opts.requestedBilling === true
        ? "Existing vaccination found for idempotency key; no linked billing order was stored"
        : "Billing was not requested",
  };

  if (vaccination?.orderId != null) {
    const order = await prisma.order.findUnique({
      where: { id: Number(vaccination.orderId) },
      select: {
        id: true,
        totalAmount: true,
        clinicInvoice: { select: { id: true } },
      },
    }).catch(() => null);
    billing = {
      status: "CREATED",
      orderId: vaccination.orderId,
      invoiceId: order?.clinicInvoice?.id ?? vaccination?.invoiceId ?? null,
      amount: order?.totalAmount != null ? Number(order.totalAmount) : null,
      message: "Existing billing order found for idempotency key",
    };
  }

  return {
    vaccination,
    stock: {
      batchId: vaccination?.inventoryBatchId ?? null,
      remainingQty,
      ledgerId: vaccination?.stockLedgerId ?? null,
    },
    billing,
    idempotency: {
      key: opts.idempotencyKey ?? vaccination?.idempotencyKey ?? null,
      replayed: true,
    },
  };
}

function buildReminderScheduleForVaccination(vaccination: any): any[] {
  if (!vaccination || vaccination.status === "VOIDED" || !vaccination.nextDueDate) return [];
  const dueDate = startOfDay(new Date(vaccination.nextDueDate));
  return REMINDER_STAGE_OFFSETS.map((entry) => {
    const scheduledFor = startOfDay(addDays(dueDate, entry.days));
    return {
      orgId: vaccination.orgId ?? null,
      branchId: vaccination.branchId ?? null,
      vaccinationId: vaccination.id,
      petId: vaccination.petId,
      ownerUserId: vaccination.pet?.userId ?? null,
      dueDate,
      dueDateSnapshot: dueDate,
      stage: entry.stage,
      channel: "IN_APP",
      status: "PENDING",
      scheduledFor,
      idempotencyKey: buildVaccinationReminderIdempotencyKey(vaccination.id, entry.stage, dueDate, "IN_APP"),
    };
  }).filter((row: any) => Number.isFinite(Number(row.orgId)) && Number.isFinite(Number(row.branchId)));
}

async function markStaleVaccinationRemindersCancelled(tx: any, vaccination: any): Promise<void> {
  if (!vaccination?.id) return;
  await tx.vaccinationReminder.updateMany({
    where: {
      vaccinationId: Number(vaccination.id),
      status: { in: ["PENDING", "FAILED", "SKIPPED"] },
    },
    data: {
      status: "CANCELLED",
      lastError:
        vaccination?.status === "VOIDED"
          ? "Vaccination was voided"
          : "Reminder replaced due to vaccination due date/status correction",
    },
  });
}

async function syncRemindersForVaccination(vaccination: any): Promise<any> {
  if (!vaccination?.id) return { synced: false, reason: "MISSING_VACCINATION" };
  const fullVaccination =
    vaccination?.pet?.userId != null && vaccination?.orgId != null && vaccination?.branchId != null
      ? vaccination
      : await prisma.vaccination.findUnique({
          where: { id: Number(vaccination.id) },
          include: { pet: { select: { id: true, userId: true } } },
        });
  if (!fullVaccination) return { synced: false, reason: "NOT_FOUND" };

  return prisma.$transaction(async (tx: any) => {
    await markStaleVaccinationRemindersCancelled(tx, fullVaccination);
    const schedule = buildReminderScheduleForVaccination(fullVaccination);
    if (!schedule.length) {
      return {
        synced: true,
        active: 0,
        cancelled: true,
      };
    }

    for (const item of schedule) {
      await tx.vaccinationReminder.upsert({
        where: { idempotencyKey: item.idempotencyKey },
        create: item,
        update: {
          orgId: item.orgId,
          branchId: item.branchId,
          petId: item.petId,
          ownerUserId: item.ownerUserId,
          dueDate: item.dueDate,
          dueDateSnapshot: item.dueDateSnapshot,
          scheduledFor: item.scheduledFor,
          status: "PENDING",
          lastError: null,
        },
      });
    }

    const active = await tx.vaccinationReminder.count({
      where: { vaccinationId: Number(fullVaccination.id), status: "PENDING" },
    });
    return { synced: true, active };
  });
}

async function listBranchVaccinationReminders(
  branchId: number,
  filters: { status?: string; from?: Date | null; to?: Date | null; overdueOnly?: boolean; petId?: number | null }
): Promise<any> {
  const normalizedBranchId = Number(branchId);
  if (!Number.isFinite(normalizedBranchId) || normalizedBranchId <= 0) throw createHttpError("Invalid branchId", 400);
  const branch = await prisma.branch.findUnique({ where: { id: normalizedBranchId }, select: { id: true, orgId: true } });
  if (!branch) throw createHttpError("Branch not found", 404);

  const where: any = {
    branchId: normalizedBranchId,
    orgId: branch.orgId,
  };
  if (filters.status) {
    const normalizedStatus = String(filters.status).toUpperCase();
    const allowedStatus = ["PENDING", "SENT", "SKIPPED", "FAILED", "CANCELLED"];
    if (!allowedStatus.includes(normalizedStatus)) throw createHttpError("Invalid reminder status filter", 400);
    where.status = normalizedStatus;
  }
  if (filters.petId != null) where.petId = Number(filters.petId);
  if (filters.from || filters.to) {
    where.scheduledFor = {};
    if (filters.from) where.scheduledFor.gte = startOfDay(filters.from);
    if (filters.to) where.scheduledFor.lte = startOfDay(filters.to);
  }
  if (filters.overdueOnly === true) {
    where.stage = "OVERDUE";
    where.status = where.status || "PENDING";
    where.scheduledFor = { ...(where.scheduledFor || {}), lte: startOfDay(new Date()) };
  }

  const rows = await prisma.vaccinationReminder.findMany({
    where,
    include: {
      pet: {
        select: {
          id: true,
          name: true,
          uniquePetId: true,
          user: {
            select: {
              id: true,
              profile: { select: { displayName: true, username: true } },
              auth: { select: { phone: true, email: true } },
            },
          },
        },
      },
      vaccination: {
        select: {
          id: true,
          status: true,
          nextDueDate: true,
          vaccineType: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
    take: 500,
  });

  return {
    branchId: normalizedBranchId,
    orgId: branch.orgId,
    items: rows
      .filter((row: any) => row?.vaccination?.status !== "VOIDED")
      .map((row: any) => ({
        id: row.id,
        pet: row.pet
          ? {
              id: row.pet.id,
              name: row.pet.name ?? null,
              uniquePetId: row.pet.uniquePetId ?? null,
            }
          : null,
        owner: row.pet?.user
          ? {
              userId: row.pet.user.id,
              displayName: row.pet.user.profile?.displayName ?? null,
              username: row.pet.user.profile?.username ?? null,
              phone: row.pet.user.auth?.phone ?? null,
              email: row.pet.user.auth?.email ?? null,
            }
          : null,
        vaccineName: row.vaccination?.vaccineType?.name ?? null,
        dueDate: row.dueDate,
        stage: row.stage,
        status: row.status,
        channel: row.channel,
        scheduledFor: row.scheduledFor,
      })),
  };
}

async function listVaccineTypes(opts: { search?: string; limit?: number } = {}): Promise<any[]> {
  const search = opts.search?.trim();
  const take = Math.min(Math.max(Number(opts.limit ?? 200) || 200, 1), 500);
  const where: any = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }
  return prisma.vaccineType.findMany({
    where,
    include: {
      targetAnimalType: { select: { id: true, name: true } },
    },
    orderBy: { name: "asc" },
    take,
  });
}

async function getBranchVaccineInventoryMappings(branchId: number): Promise<any> {
  const normalizedBranchId = Number(branchId);
  if (!Number.isFinite(normalizedBranchId) || normalizedBranchId <= 0) throw createHttpError("Invalid branchId", 400);

  const branch = await prisma.branch.findUnique({
    where: { id: normalizedBranchId },
    select: { id: true, orgId: true, name: true },
  });
  if (!branch) throw createHttpError("Branch not found", 404);

  const [vaccineTypes, mappings] = await Promise.all([
    prisma.vaccineType.findMany({
      include: { targetAnimalType: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.vaccineInventoryMapping.findMany({
      where: { orgId: branch.orgId },
      include: {
        clinicalItem: {
          select: {
            id: true,
            orgId: true,
            itemCode: true,
            name: true,
            slug: true,
            domainType: true,
            isActive: true,
            isInventoryTracked: true,
            manufacturerName: true,
            category: { select: { id: true, name: true } },
          },
        },
        clinicalItemVariant: {
          select: {
            id: true,
            itemId: true,
            variantName: true,
            sku: true,
            isActive: true,
          },
        },
      },
      orderBy: { vaccineTypeId: "asc" },
    }),
  ]);

  const mappingByVaccineTypeId = new Map<number, any>(mappings.map((row: any) => [Number(row.vaccineTypeId), row]));
  return {
    orgId: branch.orgId,
    branchId: branch.id,
    items: vaccineTypes.map((vaccineType: any) => {
      const mapping = mappingByVaccineTypeId.get(Number(vaccineType.id)) ?? null;
      const status = getInventoryMappingStatus(mapping, branch.orgId);
      return {
        vaccineTypeId: vaccineType.id,
        vaccineTypeName: vaccineType.name,
        targetAnimalType: vaccineType.targetAnimalType ?? null,
        defaultIntervalDays: vaccineType.defaultIntervalDays ?? null,
        status,
        vaccineType: {
          id: vaccineType.id,
          name: vaccineType.name,
          description: vaccineType.description ?? null,
          defaultIntervalDays: vaccineType.defaultIntervalDays ?? null,
          targetAnimalType: vaccineType.targetAnimalType ?? null,
        },
        mapping:
          mapping == null
            ? null
            : {
                id: mapping.id,
                orgId: mapping.orgId,
                vaccineTypeId: mapping.vaccineTypeId,
                clinicalItemId: mapping.clinicalItemId,
                clinicalItemVariantId: mapping.clinicalItemVariantId ?? null,
                isActive: mapping.isActive === true,
                mappingSource: mapping.mappingSource ?? "MANUAL",
                notes: mapping.notes ?? null,
                createdByUserId: mapping.createdByUserId ?? null,
                updatedByUserId: mapping.updatedByUserId ?? null,
                createdAt: mapping.createdAt ?? null,
                updatedAt: mapping.updatedAt ?? null,
              },
        mappedClinicalItem: mapping?.clinicalItem ?? null,
        mappedClinicalItemVariant: mapping?.clinicalItemVariant ?? null,
        mappingStatus: status,
        usesFallback: status !== "MAPPED",
      };
    }),
  };
}

async function upsertVaccineInventoryMapping(data: {
  branchId: number;
  vaccineTypeId: number;
  clinicalItemId: number;
  clinicalItemVariantId?: number | null;
  isActive?: boolean;
  notes?: string | null;
  actorUserId?: number | null;
}): Promise<any> {
  const branchId = Number(data.branchId);
  const vaccineTypeId = Number(data.vaccineTypeId);
  const clinicalItemId = Number(data.clinicalItemId);
  const clinicalItemVariantId = data.clinicalItemVariantId == null ? null : Number(data.clinicalItemVariantId);
  const actorUserId = data.actorUserId != null ? Number(data.actorUserId) : null;

  if (!Number.isFinite(branchId) || branchId <= 0) throw createHttpError("Invalid branchId", 400);
  if (!Number.isFinite(vaccineTypeId) || vaccineTypeId <= 0) throw createHttpError("Invalid vaccineTypeId", 400);
  if (!Number.isFinite(clinicalItemId) || clinicalItemId <= 0) throw createHttpError("Invalid clinicalItemId", 400);
  if (clinicalItemVariantId != null && (!Number.isFinite(clinicalItemVariantId) || clinicalItemVariantId <= 0)) {
    throw createHttpError("Invalid clinicalItemVariantId", 400);
  }

  const [branch, vaccineType, clinicalItem, clinicalItemVariant] = await Promise.all([
    prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, orgId: true, name: true },
    }),
    prisma.vaccineType.findUnique({
      where: { id: vaccineTypeId },
      include: { targetAnimalType: { select: { id: true, name: true } } },
    }),
    prisma.clinicalItem.findUnique({
      where: { id: clinicalItemId },
      include: {
        category: { select: { id: true, name: true } },
      },
    }),
    clinicalItemVariantId == null
      ? Promise.resolve(null)
      : prisma.clinicalItemVariant.findUnique({
          where: { id: clinicalItemVariantId },
          select: {
            id: true,
            itemId: true,
            variantName: true,
            sku: true,
            isActive: true,
          },
        }),
  ]);

  if (!branch) throw createHttpError("Branch not found", 404);
  if (!vaccineType) throw createHttpError("Vaccine type not found", 404);
  if (!clinicalItem) throw createHttpError("Clinical item not found", 404);
  if (Number(clinicalItem.orgId) !== Number(branch.orgId)) {
    throw createHttpError("Clinical item does not belong to this branch organization", 400);
  }
  if (clinicalItem.isActive !== true) throw createHttpError("Clinical item is inactive", 400);
  if (clinicalItem.isInventoryTracked !== true) throw createHttpError("Clinical item must be inventory tracked", 400);
  if (String(clinicalItem.domainType || "").toUpperCase() !== "MEDICINE") {
    throw createHttpError("Clinical item must use MEDICINE domain type", 400);
  }
  if (!isVaccineLikeClinicalItem(clinicalItem)) {
    throw createHttpError("Clinical item must be vaccine-like for vaccine inventory mapping", 400);
  }
  if (clinicalItemVariantId != null) {
    if (!clinicalItemVariant) throw createHttpError("Clinical item variant not found", 404);
    if (Number(clinicalItemVariant.itemId) !== Number(clinicalItem.id)) {
      throw createHttpError("Clinical item variant does not belong to the selected item", 400);
    }
  }

  const isActive = data.isActive !== undefined ? data.isActive === true : true;
  const notes = data.notes != null ? String(data.notes).trim() || null : null;

  const mapping = await prisma.vaccineInventoryMapping.upsert({
    where: { orgId_vaccineTypeId: { orgId: branch.orgId, vaccineTypeId } },
    create: {
      orgId: branch.orgId,
      vaccineTypeId,
      clinicalItemId,
      clinicalItemVariantId,
      isActive,
      mappingSource: "MANUAL",
      notes,
      createdByUserId: actorUserId,
      updatedByUserId: actorUserId,
    },
    update: {
      clinicalItemId,
      clinicalItemVariantId,
      isActive,
      mappingSource: "MANUAL",
      notes,
      updatedByUserId: actorUserId,
    },
    include: {
      clinicalItem: {
        select: {
          id: true,
          orgId: true,
          itemCode: true,
          name: true,
          slug: true,
          domainType: true,
          isActive: true,
          isInventoryTracked: true,
          manufacturerName: true,
          category: { select: { id: true, name: true } },
        },
      },
      clinicalItemVariant: {
        select: {
          id: true,
          itemId: true,
          variantName: true,
          sku: true,
          isActive: true,
        },
      },
    },
  });

  return {
    branchId: branch.id,
    orgId: branch.orgId,
    vaccineType: {
      id: vaccineType.id,
      name: vaccineType.name,
      description: vaccineType.description ?? null,
      defaultIntervalDays: vaccineType.defaultIntervalDays ?? null,
      targetAnimalType: vaccineType.targetAnimalType ?? null,
    },
    mapping,
    mappedClinicalItem: mapping.clinicalItem ?? null,
    mappedClinicalItemVariant: mapping.clinicalItemVariant ?? null,
    mappingStatus: getInventoryMappingStatus(mapping, branch.orgId),
    usesFallback: false,
  };
}

async function getBranchVaccineStockCandidates(opts: {
  branchId: number;
  vaccineTypeId: number;
  includeExpired?: boolean;
  includeZeroStock?: boolean;
  limit?: number;
}): Promise<any> {
  const branchId = Number(opts.branchId);
  const vaccineTypeId = Number(opts.vaccineTypeId);
  if (!Number.isFinite(branchId) || branchId <= 0) throw createHttpError("Invalid branchId", 400);
  if (!Number.isFinite(vaccineTypeId) || vaccineTypeId <= 0) throw createHttpError("Invalid vaccineTypeId", 400);

  const [branch, vaccineType] = await Promise.all([
    prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, orgId: true } }),
    prisma.vaccineType.findUnique({ where: { id: vaccineTypeId } }),
  ]);
  if (!branch) throw createHttpError("Branch not found", 404);
  if (!vaccineType) throw createHttpError("Vaccine type not found", 404);

  const includeExpired = opts.includeExpired === true;
  const includeZeroStock = opts.includeZeroStock === true;
  const limit = Math.min(Math.max(Number(opts.limit ?? 20) || 20, 1), 50);
  const normalizedVaccineName = normalizeText(vaccineType.name);
  const vaccineSlug = toSlugLike(vaccineType.name);
  const explicitMapping = await fetchActiveVaccineInventoryMapping(branch.orgId, vaccineTypeId);
  const explicitMappingStatus = getInventoryMappingStatus(explicitMapping, branch.orgId);

  const where: any = {
    branchId,
    status: "ACTIVE",
    item:
      explicitMappingStatus === "MAPPED"
        ? {
            orgId: branch.orgId,
            isActive: true,
            isInventoryTracked: true,
            domainType: "MEDICINE",
          }
        : buildVaccineLikeItemWhere(branch.orgId),
  };
  if (!includeExpired) {
    where.OR = [{ expiryDate: null }, { expiryDate: { gte: startOfDay(new Date()) } }];
  }
  if (!includeZeroStock) {
    where.remainingQty = { gt: 0 };
  }

  if (explicitMappingStatus === "MAPPED" && explicitMapping?.clinicalItemId != null) {
    where.itemId = Number(explicitMapping.clinicalItemId);
    if (explicitMapping.clinicalItemVariantId != null) {
      where.variantId = Number(explicitMapping.clinicalItemVariantId);
    }
  }

  const batches = await prisma.branchItemBatch.findMany({
    where,
    include: {
      item: {
        select: {
          id: true,
          name: true,
          slug: true,
          itemCode: true,
          manufacturerName: true,
          isInventoryTracked: true,
          requiresBatch: true,
          requiresExpiry: true,
          category: { select: { id: true, name: true } },
        },
      },
      variant: {
        select: {
          id: true,
          variantName: true,
          sku: true,
        },
      },
    },
    take: 200,
  });

  const stockRows = await prisma.branchItemStock.findMany({
    where: { branchId },
    select: { itemId: true, variantId: true, availableQty: true, reorderLevel: true },
  });
  const stockByKey = new Map(stockRows.map((row: any) => [`${row.itemId}:${row.variantId}`, row]));

  if (explicitMappingStatus === "MAPPED") {
    const mappedItems = sortBranchBatchCandidates(
      batches.map((batch: any) => mapBranchBatchCandidate(batch, stockByKey.get(`${batch.itemId}:${batch.variantId}`), "explicit-mapping")),
      limit
    );
    const hasMappedStockRow = stockRows.some(
      (row: any) =>
        Number(row.itemId) === Number(explicitMapping.clinicalItemId) &&
        (explicitMapping.clinicalItemVariantId == null ||
          Number(row.variantId) === Number(explicitMapping.clinicalItemVariantId))
    );
    const message =
      mappedItems.length > 0
        ? "Mapped vaccine item found with active non-expired branch batch stock."
        : hasMappedStockRow
          ? "Mapped vaccine item found, but this branch has no active non-expired batch with remaining stock."
          : "Mapped vaccine item found, but this branch has no received stock row or active non-expired batch with remaining stock.";
    const debug = buildCandidateDebug({
      branchId,
      includeExpired,
      includeZeroStock,
      validBatchCount: mappedItems.length,
      hasMappedStockRow,
    });
    return {
      mapping: {
        status: "MATCHED",
        vaccineTypeId: vaccineType.id,
        vaccineTypeName: vaccineType.name,
        matchStrategy: "explicit-mapping",
        message,
        resolutionSource: "explicit-mapping",
        usesFallback: false,
        configuredMappingStatus: "MAPPED",
        mappedClinicalItem: explicitMapping?.clinicalItem ?? null,
        mappedClinicalItemVariant: explicitMapping?.clinicalItemVariant ?? null,
      },
      items: mappedItems,
      ...(debug ? { debug } : {}),
    };
  }

  const fallbackItems = await prisma.clinicalItem.findMany({
    where: buildVaccineLikeItemWhere(branch.orgId),
    include: {
      category: { select: { id: true, name: true } },
      variants: {
        where: { isActive: true },
        select: { id: true, variantName: true, sku: true },
      },
    },
    orderBy: { name: "asc" },
    take: 200,
  });
  const fallbackItemMatches = fallbackItems
    .flatMap((item: any) => {
      const variants = Array.isArray(item.variants) && item.variants.length ? item.variants : [null];
      return variants.map((variant: any) => {
        const match = rankVaccineItemMatch(item, variant, normalizedVaccineName, vaccineSlug);
        return {
          itemId: item.id,
          variantId: variant?.id ?? null,
          matchRank: match.rank,
          matchStrategy: match.strategy,
        };
      });
    })
    .filter((row: any) => row.matchRank < 999);
  const bestFallbackItemRank = fallbackItemMatches.length
    ? Math.min(...fallbackItemMatches.map((row: any) => row.matchRank))
    : null;
  const bestFallbackItemMatches =
    bestFallbackItemRank == null
      ? []
      : fallbackItemMatches.filter((row: any) => row.matchRank === bestFallbackItemRank);
  const fallbackMatchedItemIds = Array.from(new Set(bestFallbackItemMatches.map((row: any) => row.itemId)));

  const enriched = batches
    .map((batch: any) => {
      const stock = stockByKey.get(`${batch.itemId}:${batch.variantId}`) as
        | { availableQty?: unknown; reorderLevel?: unknown }
        | undefined;
      const match = rankVaccineItemMatch(batch.item, batch.variant, normalizedVaccineName, vaccineSlug);

      return {
        ...mapBranchBatchCandidate(batch, stock, match.strategy),
        matchRank: match.rank,
      };
    })
    .filter((row: any) => row.matchRank < 999);

  const bestRank = bestFallbackItemRank ?? (enriched.length ? Math.min(...enriched.map((row: any) => row.matchRank)) : null);
  const matched = bestRank == null ? [] : enriched.filter((row: any) => row.matchRank === bestRank);
  const distinctItemIds = fallbackMatchedItemIds.length
    ? fallbackMatchedItemIds
    : Array.from(new Set(matched.map((row: any) => row.itemId)));

  let mappingStatus = "UNMAPPED";
  let matchStrategy = "none";
  if (distinctItemIds.length > 0) {
    matchStrategy = bestFallbackItemMatches[0]?.matchStrategy ?? matched[0]?.matchStrategy ?? "none";
    mappingStatus = distinctItemIds.length > 1 ? "AMBIGUOUS" : "MATCHED";
  }

  const sorted = sortBranchBatchCandidates(
    matched.map(({ matchRank: _matchRank, ...row }: any) => row),
    limit
  );
  const fallbackPrefix =
    explicitMappingStatus === "INACTIVE"
      ? "Configured vaccine mapping is inactive, so temporary fallback matching was used. "
      : explicitMappingStatus === "INVALID_ITEM"
        ? "Configured vaccine mapping is invalid, so temporary fallback matching was used. "
        : "";
  const message =
    mappingStatus === "AMBIGUOUS"
      ? `${fallbackPrefix}Multiple possible vaccine stock items found. Configure Vaccine Mapping for accuracy.`
      : mappingStatus === "MATCHED" && sorted.length === 0
        ? `${fallbackPrefix}Matching vaccine item found, but this branch has no active non-expired batch with remaining stock.`
        : mappingStatus === "MATCHED"
          ? `${fallbackPrefix}Temporary fallback matched vaccine stock by item or variant name. Configure Vaccine Mapping for accuracy.`
          : `${fallbackPrefix}No inventory item is mapped to this vaccine type and fallback matching found no branch vaccine item. Configure Vaccine Mapping or receive a matching vaccine item in branch stock.`;
  const debug = buildCandidateDebug({
    branchId,
    includeExpired,
    includeZeroStock,
    validBatchCount: sorted.length,
    fallbackMatchedItemCount: distinctItemIds.length,
    configuredMappingStatus: explicitMappingStatus,
  });

  return {
    mapping: {
      status: mappingStatus,
      vaccineTypeId: vaccineType.id,
      vaccineTypeName: vaccineType.name,
      matchStrategy,
      message,
      resolutionSource: "fallback",
      usesFallback: true,
      configuredMappingStatus: explicitMappingStatus,
      mappedClinicalItem: explicitMapping?.clinicalItem ?? null,
      mappedClinicalItemVariant: explicitMapping?.clinicalItemVariant ?? null,
    },
    items: sorted,
    ...(debug ? { debug } : {}),
  };
}

async function getBranchVaccinationDashboard(branchId: number): Promise<any> {
  try {
    const now = new Date();
    const todayStart = startOfDay(now);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const upcomingEnd = new Date(tomorrowStart);
    upcomingEnd.setDate(upcomingEnd.getDate() + 30);
    const branchPetScope = branchScopedPetWhere(branchId);
    const baseWhere = { pet: branchPetScope, status: { not: "VOIDED" } };
    const includeRecordContext = {
      vaccineType: { select: { id: true, name: true, defaultIntervalDays: true } },
      pet: {
        select: {
          id: true,
          name: true,
          uniquePetId: true,
          user: {
            select: {
              id: true,
              profile: { select: { displayName: true, username: true } },
              auth: { select: { email: true, phone: true } },
            },
          },
          animalType: { select: { id: true, name: true } },
        },
      },
    };

    const [todayDue, upcoming, overdue, administeredToday, recentRecords] = await Promise.all([
      prisma.vaccination.count({
        where: {
          ...baseWhere,
          nextDueDate: { gte: todayStart, lt: tomorrowStart },
        },
      }),
      prisma.vaccination.count({
        where: {
          ...baseWhere,
          nextDueDate: { gte: tomorrowStart, lte: upcomingEnd },
        },
      }),
      prisma.vaccination.count({
        where: {
          ...baseWhere,
          nextDueDate: { lt: todayStart },
        },
      }),
      prisma.vaccination.count({
        where: {
          ...baseWhere,
          administeredAt: { gte: todayStart, lt: tomorrowStart },
        },
      }),
      prisma.vaccination.findMany({
        where: baseWhere,
        include: includeRecordContext,
        orderBy: { administeredAt: "desc" },
        take: 15,
      }),
    ]);

    return {
      summary: {
        todayDue,
        upcoming,
        overdue,
        administeredToday,
        recentRecords: recentRecords.length,
        upcomingWindowDays: 30,
      },
      recentRecords: recentRecords.map((record: any) => normalizeVaccinationRecord(record)),
    };
  } catch (_) {
    return {
      summary: {
        todayDue: 0,
        upcoming: 0,
        overdue: 0,
        administeredToday: 0,
        recentRecords: 0,
        upcomingWindowDays: 30,
      },
      recentRecords: [],
    };
  }
}

async function listVaccinationBillingOptions(branchId: number): Promise<any> {
  return billingService.listVaccinationBillingOptions(Number(branchId));
}

async function listByPet(petId: number): Promise<any[]> {
  const items = await prisma.vaccination.findMany({
    where: { petId },
    include: { vaccineType: true },
    orderBy: { administeredAt: "desc" },
  });
  return items.map((item: any) => normalizeVaccinationRecord(item));
}

async function getNextDueByPet(petId: number): Promise<{ vaccination: any; nextDue: Date }[]> {
  const vaccinations = await prisma.vaccination.findMany({
    where: { petId, nextDueDate: { not: null, gte: new Date() }, status: { not: "VOIDED" } },
    include: { vaccineType: true },
    orderBy: { nextDueDate: "asc" },
  });
  return vaccinations.map((v: any) => ({ vaccination: normalizeVaccinationRecord(v), nextDue: v.nextDueDate }));
}

async function recordVaccination(data: {
  petId: number;
  vaccineTypeId: number;
  administeredAt?: Date;
  nextDueDate?: Date;
  batchNumber?: string;
  manufacturer?: string;
  vetClinic?: string;
  notes?: string;
  actorId?: number | null;
  actorRole?: string | null;
  traceId?: string | null;
  ip?: string | null;
}): Promise<any> {
  const vaccineType = await prisma.vaccineType.findUnique({ where: { id: data.vaccineTypeId } });
  if (!vaccineType) {
    const error: any = new Error("Vaccine type not found");
    error.statusCode = 404;
    throw error;
  }
  const nextDue = data.nextDueDate ?? (vaccineType ? new Date(Date.now() + vaccineType.defaultIntervalDays * 86400000) : null);
  const certToken = generateCertificateToken();
  const vaccination = await prisma.$transaction(async (tx: any) => {
    const created = await tx.vaccination.create({
      data: {
        petId: data.petId,
        vaccineTypeId: data.vaccineTypeId,
        createdByUserId: data.actorId ?? null,
        updatedByUserId: data.actorId ?? null,
        status: "ACTIVE",
        administeredAt: data.administeredAt ?? new Date(),
        nextDueDate: nextDue,
        batchNumber: data.batchNumber ?? null,
        manufacturer: data.manufacturer ?? null,
        vetClinic: data.vetClinic ?? null,
        certificateToken: certToken,
        notes: data.notes ?? null,
      },
      include: { vaccineType: true },
    });
    await writeVaccinationAuditEvent(tx, {
      actionKey: "VACCINATION_CREATED",
      vaccination: created,
      actorUserId: data.actorId ?? null,
      actorRole: data.actorRole ?? null,
      traceId: data.traceId ?? null,
      ip: data.ip ?? null,
      metadata: {
        mode: "MANUAL",
        beforeFields: null,
        afterFields: {
          administeredAt: created.administeredAt,
          nextDueDate: created.nextDueDate,
          batchNumber: created.batchNumber,
          manufacturer: created.manufacturer,
          notes: created.notes,
        },
      },
    });
    return created;
  });
  await syncRemindersForVaccination(vaccination);
  return normalizeVaccinationRecord(vaccination);
}

async function administerVaccinationWithBatch(data: {
  branchId: number;
  petId: number;
  vaccineTypeId: number;
  batchId: number;
  administeredAt?: Date;
  nextDueDate?: Date;
  notes?: string;
  actorId?: number;
  createBilling?: boolean;
  visitId?: number | null;
  appointmentId?: number | null;
  serviceId?: number | null;
  pricingVariantId?: number | null;
  unitPrice?: number | null;
  quantity?: number | null;
  discountAmount?: number | null;
  billingNotes?: string | null;
  idempotencyKey?: string | null;
  actorRole?: string | null;
  traceId?: string | null;
  ip?: string | null;
}): Promise<any> {
  const branchId = Number(data.branchId);
  const petId = Number(data.petId);
  const vaccineTypeId = Number(data.vaccineTypeId);
  const batchId = Number(data.batchId);
  const actorId = data.actorId != null ? Number(data.actorId) : null;
  const idempotencyKey = data.idempotencyKey ? String(data.idempotencyKey).trim() : "";

  if (!Number.isFinite(branchId) || branchId <= 0) throw createHttpError("Invalid branchId", 400);
  if (!Number.isFinite(petId) || petId <= 0) throw createHttpError("Invalid petId", 400);
  if (!Number.isFinite(vaccineTypeId) || vaccineTypeId <= 0) throw createHttpError("Invalid vaccineTypeId", 400);
  if (!Number.isFinite(batchId) || batchId <= 0) throw createHttpError("Invalid batchId", 400);
  if (!actorId || !Number.isFinite(actorId) || actorId <= 0) throw createHttpError("Unauthorized", 401);
  if (idempotencyKey && idempotencyKey.length > 128) throw createHttpError("idempotencyKey is too long", 400);

  const [branch, vaccineType, actorBranchMember] = await Promise.all([
    prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, orgId: true } }),
    prisma.vaccineType.findUnique({ where: { id: vaccineTypeId } }),
    prisma.branchMember.findFirst({
      where: { branchId, userId: actorId, status: "ACTIVE" },
      select: {
        id: true,
        clinicStaffProfile: { select: { staffType: true } },
      },
    }).catch(() => null),
  ]);
  if (!branch) throw createHttpError("Branch not found", 404);
  if (!vaccineType) throw createHttpError("Vaccine type not found", 404);

  if (idempotencyKey) {
    const existing = await prisma.vaccination.findFirst({
      where: { branchId, idempotencyKey },
      include: { vaccineType: true },
      orderBy: { id: "desc" },
    });
    if (existing) {
      return buildAdministerReplayPayload(existing, {
        requestedBilling: data.createBilling === true,
        idempotencyKey,
      });
    }
  }

  let billingPlan: any = null;
  if (data.createBilling === true) {
    try {
      billingPlan = await billingService.prepareVaccinationBilling({
        branchId,
        petId,
        vaccineTypeId,
        batchId,
        visitId: data.visitId ?? null,
        appointmentId: data.appointmentId ?? null,
        serviceId: data.serviceId ?? null,
        pricingVariantId: data.pricingVariantId ?? null,
        unitPrice: data.unitPrice ?? null,
        quantity: data.quantity ?? null,
        discountAmount: data.discountAmount ?? null,
        billingNotes: data.billingNotes ?? null,
      });
    } catch (error: any) {
      throw createHttpError(error?.message || "Invalid vaccination billing request", 400);
    }
  }

  const nextDue =
    data.nextDueDate ??
    (vaccineType.defaultIntervalDays
      ? new Date(Date.now() + vaccineType.defaultIntervalDays * 86400000)
      : null);

  const clinicalResult = await prisma.$transaction(async (tx: any) => {
    if (idempotencyKey) {
      const existing = await tx.vaccination.findFirst({
        where: { branchId, idempotencyKey },
        include: { vaccineType: true },
        orderBy: { id: "desc" },
      });
      if (existing) {
        return {
          replayed: true,
          vaccination: existing,
          stock: {
            batchId: existing.inventoryBatchId ?? null,
            remainingQty: 0,
            ledgerId: existing.stockLedgerId ?? null,
          },
        };
      }
    }

    const batch = await tx.branchItemBatch.findUnique({
      where: { id: batchId },
      include: {
        item: {
          select: {
            id: true,
            name: true,
            manufacturerName: true,
          },
        },
        variant: {
          select: {
            id: true,
            variantName: true,
          },
        },
      },
    });

    if (!batch) throw createHttpError("Batch not found", 404);
    if (Number(batch.branchId) !== branchId) throw createHttpError("Selected batch does not belong to this branch", 400);
    if (String(batch.status || "").toUpperCase() !== "ACTIVE") throw createHttpError("Selected batch is not active", 400);
    if (isExpiredBatch(batch.expiryDate)) throw createHttpError("Selected batch is expired", 400);
    if (toSafeNumber(batch.remainingQty) < 1) throw createHttpError("Insufficient stock in selected batch", 400);

    const certToken = generateCertificateToken();
    const vaccination = await tx.vaccination.create({
      data: {
        petId,
        vaccineTypeId,
        orgId: branch.orgId,
        branchId,
        inventoryBatchId: batchId,
        clinicalItemId: batch.itemId,
        clinicalItemVariantId: batch.variantId,
        administeredByUserId: actorId,
        administeredByDoctorId:
          String(actorBranchMember?.clinicStaffProfile?.staffType || "").toUpperCase() === "DOCTOR"
            ? actorBranchMember?.id ?? null
            : null,
        administeredByStaffId:
          actorBranchMember?.id != null &&
          String(actorBranchMember?.clinicStaffProfile?.staffType || "").toUpperCase() !== "DOCTOR"
            ? actorBranchMember.id
            : null,
        createdByUserId: actorId,
        updatedByUserId: actorId,
        status: "ACTIVE",
        idempotencyKey: idempotencyKey || null,
        administeredAt: data.administeredAt ?? new Date(),
        nextDueDate: nextDue,
        batchNumber: batch.batchNo ?? null,
        manufacturer: batch.item?.manufacturerName ?? null,
        vetClinic: null,
        certificateToken: certToken,
        notes: data.notes ?? null,
      },
      include: { vaccineType: true },
    });

    const ledgerResult = await recordClinicalLedgerEntry(tx, {
      orgId: branch.orgId,
      branchId,
      clinicalItemId: batch.itemId,
      variantId: batch.variantId,
      batchId,
      txnType: "VACCINATION_ADMINISTRATION",
      quantityDelta: -1,
      refType: "VACCINATION",
      refId: String(vaccination.id),
      note: `Vaccination administration for pet ${petId}`,
      actorId,
    });

    const updatedBatch = await tx.branchItemBatch.findUnique({
      where: { id: batchId },
      select: { id: true, remainingQty: true },
    });

    const updatedVaccination = await tx.vaccination.update({
      where: { id: vaccination.id },
      data: {
        stockLedgerId: ledgerResult.ledgerId,
        updatedByUserId: actorId,
      },
      include: { vaccineType: true },
    });

    await writeVaccinationAuditEvent(tx, {
      actionKey: "VACCINATION_CREATED",
      vaccination: updatedVaccination,
      actorUserId: actorId,
      actorRole: data.actorRole ?? null,
      traceId: data.traceId ?? null,
      ip: data.ip ?? null,
      metadata: {
        mode: "STOCK_BACKED",
        beforeFields: null,
        afterFields: {
          administeredAt: updatedVaccination.administeredAt,
          nextDueDate: updatedVaccination.nextDueDate,
          batchNumber: updatedVaccination.batchNumber,
          manufacturer: updatedVaccination.manufacturer,
          notes: updatedVaccination.notes,
        },
      },
    });
    await writeVaccinationAuditEvent(tx, {
      actionKey: "VACCINATION_ADMINISTERED",
      vaccination: updatedVaccination,
      actorUserId: actorId,
      actorRole: data.actorRole ?? null,
      traceId: data.traceId ?? null,
      ip: data.ip ?? null,
      metadata: {
        batchId,
        stockLedgerId: ledgerResult.ledgerId,
        quantityDelta: -1,
        mode: "STOCK_BACKED",
      },
    });

    return {
      replayed: false,
      vaccination: updatedVaccination,
      stock: {
        batchId,
        remainingQty: updatedBatch ? toSafeNumber(updatedBatch.remainingQty) : 0,
        ledgerId: ledgerResult.ledgerId,
      },
    };
  });

  if (clinicalResult?.replayed) {
    await syncRemindersForVaccination(clinicalResult.vaccination);
    return buildAdministerReplayPayload(clinicalResult.vaccination, {
      requestedBilling: data.createBilling === true,
      idempotencyKey: idempotencyKey || null,
    });
  }

  if (!billingPlan) {
    await syncRemindersForVaccination(clinicalResult.vaccination);
    return {
      vaccination: normalizeVaccinationRecord(clinicalResult.vaccination),
      stock: clinicalResult.stock,
      billing: {
        status: "SKIPPED",
        orderId: null,
        invoiceId: null,
        amount: null,
        message: "Billing was not requested",
      },
      idempotency: {
        key: idempotencyKey || null,
        replayed: false,
      },
    };
  }

  try {
    const billingResult = await billingService.createVaccinationBillingOrder(
      {
        ...billingPlan,
        vaccinationId: clinicalResult.vaccination?.id ?? null,
      },
      actorId
    );
    const updatedVaccination = await prisma.vaccination.update({
      where: { id: clinicalResult.vaccination.id },
      data: {
        orderId: billingResult.billing.orderId ?? null,
        invoiceId: billingResult.billing.invoiceId ?? null,
        updatedByUserId: actorId,
      },
      include: { vaccineType: true },
    });
    await writeVaccinationAuditEvent(prisma, {
      actionKey: "VACCINATION_BILLED",
      vaccination: updatedVaccination,
      actorUserId: actorId,
      actorRole: data.actorRole ?? null,
      traceId: data.traceId ?? null,
      ip: data.ip ?? null,
      metadata: {
        orderId: billingResult.billing.orderId ?? null,
        invoiceId: billingResult.billing.invoiceId ?? null,
        amount: billingResult.billing.amount ?? null,
        billingStatus: billingResult.billing.status ?? null,
      },
    });
    await syncRemindersForVaccination(updatedVaccination);
    return {
      vaccination: normalizeVaccinationRecord(updatedVaccination),
      stock: clinicalResult.stock,
      billing: billingResult.billing,
      idempotency: {
        key: idempotencyKey || null,
        replayed: false,
      },
    };
  } catch (error: any) {
    await writeVaccinationAuditEvent(prisma, {
      actionKey: "VACCINATION_BILLING_FAILED",
      vaccination: clinicalResult.vaccination,
      actorUserId: actorId,
      actorRole: data.actorRole ?? null,
      traceId: data.traceId ?? null,
      ip: data.ip ?? null,
      metadata: {
        requestedAmount: billingPlan.totalAmount ?? null,
        message: error?.message || "Vaccination saved and stock deducted, but billing creation failed",
      },
    }).catch(() => null);
    await syncRemindersForVaccination(clinicalResult.vaccination);
    return {
      vaccination: normalizeVaccinationRecord(clinicalResult.vaccination),
      stock: clinicalResult.stock,
      billing: {
        status: "FAILED",
        orderId: null,
        invoiceId: null,
        amount: billingPlan.totalAmount ?? null,
        message: error?.message || "Vaccination saved and stock deducted, but billing creation failed",
      },
      idempotency: {
        key: idempotencyKey || null,
        replayed: false,
      },
    };
  }
}

async function correctVaccinationRecord(data: {
  branchId: number;
  vaccinationId: number;
  correctionReason: string;
  administeredAt?: Date;
  nextDueDate?: Date | null;
  notes?: string | null;
  manufacturer?: string | null;
  batchNumber?: string | null;
  actorId?: number | null;
  actorRole?: string | null;
  traceId?: string | null;
  ip?: string | null;
  hasAdministeredAt?: boolean;
  hasNextDueDate?: boolean;
  hasNotes?: boolean;
  hasManufacturer?: boolean;
  hasBatchNumber?: boolean;
}): Promise<any> {
  const branchId = Number(data.branchId);
  const vaccinationId = Number(data.vaccinationId);
  const actorId = data.actorId != null ? Number(data.actorId) : null;
  const correctionReason = String(data.correctionReason ?? "").trim();

  if (!Number.isFinite(branchId) || branchId <= 0) throw createHttpError("Invalid branchId", 400);
  if (!Number.isFinite(vaccinationId) || vaccinationId <= 0) throw createHttpError("Invalid vaccinationId", 400);
  if (!correctionReason) throw createHttpError("correctionReason is required", 400);
  if (correctionReason.length < 3) throw createHttpError("correctionReason must be at least 3 characters", 400);

  const hasAnyChange =
    data.hasAdministeredAt === true ||
    data.hasNextDueDate === true ||
    data.hasNotes === true ||
    data.hasManufacturer === true ||
    data.hasBatchNumber === true;
  if (!hasAnyChange) {
    throw createHttpError("At least one allowed correction field is required", 400);
  }

  const result = await prisma.$transaction(async (tx: any) => {
    const existing = await tx.vaccination.findFirst({
      where: buildVaccinationVisibilityWhere(branchId, vaccinationId),
      include: { vaccineType: true },
    });
    if (!existing) throw createHttpError("Vaccination not found for this branch", 404);
    if (existing.status === "VOIDED") throw createHttpError("VOIDED vaccination records cannot be corrected", 409);

    const beforeFields = {
      administeredAt: existing.administeredAt,
      nextDueDate: existing.nextDueDate,
      notes: existing.notes,
      manufacturer: existing.manufacturer,
      batchNumber: existing.batchNumber,
      status: existing.status,
    };

    const updateData: any = {
      status: "CORRECTED",
      correctionReason,
      correctedAt: new Date(),
      correctedByUserId: actorId,
      updatedByUserId: actorId,
    };
    if (data.hasAdministeredAt === true) updateData.administeredAt = data.administeredAt;
    if (data.hasNextDueDate === true) updateData.nextDueDate = data.nextDueDate ?? null;
    if (data.hasNotes === true) updateData.notes = data.notes ?? null;
    if (data.hasManufacturer === true) updateData.manufacturer = data.manufacturer ?? null;
    if (data.hasBatchNumber === true) updateData.batchNumber = data.batchNumber ?? null;

    const changes: string[] = [];
    if (data.hasAdministeredAt === true) {
      const before = existing.administeredAt ? new Date(existing.administeredAt).getTime() : null;
      const after = updateData.administeredAt ? new Date(updateData.administeredAt).getTime() : null;
      if (before !== after) changes.push("administeredAt");
    }
    if (data.hasNextDueDate === true) {
      const before = existing.nextDueDate ? new Date(existing.nextDueDate).getTime() : null;
      const after = updateData.nextDueDate ? new Date(updateData.nextDueDate).getTime() : null;
      if (before !== after) changes.push("nextDueDate");
    }
    if (data.hasNotes === true && (existing.notes ?? null) !== (updateData.notes ?? null)) changes.push("notes");
    if (data.hasManufacturer === true && (existing.manufacturer ?? null) !== (updateData.manufacturer ?? null)) {
      changes.push("manufacturer");
    }
    if (data.hasBatchNumber === true && (existing.batchNumber ?? null) !== (updateData.batchNumber ?? null)) {
      changes.push("batchNumber");
    }
    if (!changes.length) throw createHttpError("No changes detected for allowed correction fields", 400);

    const updated = await tx.vaccination.update({
      where: { id: existing.id },
      data: updateData,
      include: { vaccineType: true },
    });

    await writeVaccinationAuditEvent(tx, {
      actionKey: "VACCINATION_CORRECTED",
      vaccination: updated,
      actorUserId: actorId,
      actorRole: data.actorRole ?? null,
      traceId: data.traceId ?? null,
      ip: data.ip ?? null,
      metadata: {
        reason: correctionReason,
        changedFields: changes,
        beforeFields,
        afterFields: {
          administeredAt: updated.administeredAt,
          nextDueDate: updated.nextDueDate,
          notes: updated.notes,
          manufacturer: updated.manufacturer,
          batchNumber: updated.batchNumber,
          status: updated.status,
        },
      },
    });

    return updated;
  });
  await syncRemindersForVaccination(result);

  return {
    vaccination: normalizeVaccinationRecord(result),
    warnings: buildVaccinationWarningObject(result),
    auditWritten: true,
  };
}

async function voidVaccinationRecord(data: {
  branchId: number;
  vaccinationId: number;
  voidReason: string;
  actorId?: number | null;
  actorRole?: string | null;
  traceId?: string | null;
  ip?: string | null;
}): Promise<any> {
  const branchId = Number(data.branchId);
  const vaccinationId = Number(data.vaccinationId);
  const actorId = data.actorId != null ? Number(data.actorId) : null;
  const voidReason = String(data.voidReason ?? "").trim();

  if (!Number.isFinite(branchId) || branchId <= 0) throw createHttpError("Invalid branchId", 400);
  if (!Number.isFinite(vaccinationId) || vaccinationId <= 0) throw createHttpError("Invalid vaccinationId", 400);
  if (!voidReason) throw createHttpError("voidReason is required", 400);
  if (voidReason.length < 3) throw createHttpError("voidReason must be at least 3 characters", 400);

  const result = await prisma.$transaction(async (tx: any) => {
    const existing = await tx.vaccination.findFirst({
      where: buildVaccinationVisibilityWhere(branchId, vaccinationId),
      include: { vaccineType: true },
    });
    if (!existing) throw createHttpError("Vaccination not found for this branch", 404);

    if (existing.status === "VOIDED") {
      return {
        alreadyVoided: true,
        vaccination: existing,
      };
    }

    const updated = await tx.vaccination.update({
      where: { id: existing.id },
      data: {
        status: "VOIDED",
        voidReason,
        voidedAt: new Date(),
        voidedByUserId: actorId,
        updatedByUserId: actorId,
      },
      include: { vaccineType: true },
    });

    await writeVaccinationAuditEvent(tx, {
      actionKey: "VACCINATION_VOIDED",
      vaccination: updated,
      actorUserId: actorId,
      actorRole: data.actorRole ?? null,
      traceId: data.traceId ?? null,
      ip: data.ip ?? null,
      metadata: {
        reason: voidReason,
        beforeStatus: existing.status,
        afterStatus: updated.status,
      },
    });

    return {
      alreadyVoided: false,
      vaccination: updated,
    };
  });

  const vaccination = normalizeVaccinationRecord(result.vaccination);
  await syncRemindersForVaccination(result.vaccination);
  const warnings = buildVaccinationWarningObject(vaccination);
  return {
    alreadyVoided: result.alreadyVoided === true,
    vaccination,
    warnings,
    auditWritten: result.alreadyVoided !== true,
  };
}

async function getVaccinationAudit(branchId: number, vaccinationId: number): Promise<any> {
  const normalizedBranchId = Number(branchId);
  const normalizedVaccinationId = Number(vaccinationId);
  if (!Number.isFinite(normalizedBranchId) || normalizedBranchId <= 0) throw createHttpError("Invalid branchId", 400);
  if (!Number.isFinite(normalizedVaccinationId) || normalizedVaccinationId <= 0) throw createHttpError("Invalid vaccinationId", 400);

  const vaccination = await prisma.vaccination.findFirst({
    where: buildVaccinationVisibilityWhere(normalizedBranchId, normalizedVaccinationId),
    include: { vaccineType: true },
  });
  if (!vaccination) throw createHttpError("Vaccination not found for this branch", 404);

  const events = await prisma.auditEvent.findMany({
    where: {
      entityType: "VACCINATION",
      entityId: String(vaccination.id),
    },
    orderBy: { createdAt: "asc" },
  }).catch(() => []);

  const warningMessages = buildVaccinationWarnings(vaccination);
  const warningSummary = buildVaccinationWarningObject(vaccination);
  const legacyWarning =
    vaccination.branchId == null ||
    (vaccination.stockLedgerId == null && vaccination.orderId == null && vaccination.invoiceId == null)
      ? "Legacy or sparse durable references detected for this vaccination record."
      : null;
  if (legacyWarning) warningMessages.push(legacyWarning);
  if (!events.length) {
    warningMessages.push("No durable vaccination audit events were found for this record. Older records may predate audit event writes.");
  }

  return {
    vaccinationId: vaccination.id,
    vaccination: normalizeVaccinationRecord(vaccination),
    created: {
      createdAt: vaccination.createdAt ?? null,
      createdByUserId: vaccination.createdByUserId ?? null,
      administeredAt: vaccination.administeredAt ?? null,
      status: vaccination.status ?? "ACTIVE",
    },
    correction: {
      correctionReason: vaccination.correctionReason ?? null,
      correctedAt: vaccination.correctedAt ?? null,
      correctedByUserId: vaccination.correctedByUserId ?? null,
    },
    void: {
      voidReason: vaccination.voidReason ?? null,
      voidedAt: vaccination.voidedAt ?? null,
      voidedByUserId: vaccination.voidedByUserId ?? null,
    },
    refs: {
      branchId: vaccination.branchId ?? null,
      orgId: vaccination.orgId ?? null,
      inventoryBatchId: vaccination.inventoryBatchId ?? null,
      clinicalItemId: vaccination.clinicalItemId ?? null,
      clinicalItemVariantId: vaccination.clinicalItemVariantId ?? null,
      stockLedgerId: vaccination.stockLedgerId ?? null,
      orderId: vaccination.orderId ?? null,
      invoiceId: vaccination.invoiceId ?? null,
      certificateToken: vaccination.certificateToken ?? null,
    },
    warningSummary,
    warnings: warningMessages,
    legacyWarning,
    events: Array.isArray(events) ? events.map((row: any) => mapAuditEventRow(row)) : [],
  };
}

async function getByCertificateToken(token: string): Promise<any | null> {
  const record = await prisma.vaccination.findUnique({
    where: { certificateToken: token },
    include: { pet: { include: { animalType: true } }, vaccineType: true },
  });
  return normalizeVaccinationRecord(record);
}

async function listDewormingByPet(petId: number): Promise<any[]> {
  return prisma.dewormingRecord.findMany({
    where: { petId },
    orderBy: { administeredAt: "desc" },
  });
}

async function recordDeworming(data: { petId: number; medicationName: string; dosage?: string; weightAtTime?: number; nextDueDate?: Date; notes?: string }): Promise<any> {
  return prisma.dewormingRecord.create({
    data: {
      petId: data.petId,
      medicationName: data.medicationName,
      dosage: data.dosage ?? null,
      weightAtTime: data.weightAtTime ?? null,
      nextDueDate: data.nextDueDate ?? null,
      notes: data.notes ?? null,
    },
  });
}

module.exports = {
  buildReminderScheduleForVaccination,
  syncRemindersForVaccination,
  listBranchVaccinationReminders,
  listVaccineTypes,
  getBranchVaccineInventoryMappings,
  upsertVaccineInventoryMapping,
  getBranchVaccinationDashboard,
  listVaccinationBillingOptions,
  getBranchVaccineStockCandidates,
  listByPet,
  getNextDueByPet,
  recordVaccination,
  administerVaccinationWithBatch,
  correctVaccinationRecord,
  voidVaccinationRecord,
  getVaccinationAudit,
  getByCertificateToken,
  listDewormingByPet,
  recordDeworming,
};
