/**
 * Dispense Control Service (CCMLPA) — request-based medicine issue; blocks new issue if prior vial unresolved.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import * as ledger from "../inventory/ledger.service";
import * as medicinePolicy from "./medicinePolicy.service";

export type CreateDispenseRequestInput = {
  branchId: number;
  orgId: number;
  requestedByUserId: number;
  patientId?: number | null;
  visitId?: number | null;
  surgeryCaseId?: number | null;
  treatmentCourseId?: number | null;
  urgencyLevel?: "NORMAL" | "URGENT" | "EMERGENCY";
  items: { variantId: number; requestedQty: number; unit?: string | null; reason?: string | null }[];
};

/**
 * Create a dispense request (doctor/staff). Does not check active vial here; that is enforced at issue.
 */
export async function createRequest(data: CreateDispenseRequestInput): Promise<any> {
  const request = await prisma.dispenseRequest.create({
    data: {
      orgId: data.orgId,
      branchId: data.branchId,
      requestedByUserId: data.requestedByUserId,
      patientId: data.patientId ?? null,
      visitId: data.visitId ?? null,
      surgeryCaseId: data.surgeryCaseId ?? null,
      treatmentCourseId: data.treatmentCourseId ?? null,
      status: "PENDING",
      urgencyLevel: data.urgencyLevel ?? "NORMAL",
      items: {
        create: data.items.map((item) => ({
          variantId: item.variantId,
          requestedQty: item.requestedQty,
          unit: item.unit ?? null,
          reason: item.reason ?? null,
        })),
      },
    },
    include: {
      items: { include: { variant: { select: { id: true, title: true, sku: true } } } },
      requestedBy: { select: { id: true }, profile: { select: { displayName: true } } },
    },
  });
  return request;
}

/**
 * Approve a dispense request (pharmacy). Status PENDING -> APPROVED.
 */
export async function approveRequest(requestId: number, approverUserId: number): Promise<any> {
  const req = await prisma.dispenseRequest.findUnique({
    where: { id: requestId },
    include: { items: true },
  });
  if (!req || req.status !== "PENDING") throw new Error("Request not found or not pending");
  return prisma.dispenseRequest.update({
    where: { id: requestId },
    data: { status: "APPROVED" },
    include: {
      items: { include: { variant: { select: { id: true, title: true, sku: true } } } },
    },
  });
}

/**
 * Find active VialSession for same variant at branch (not exhausted/returned/expired/destroyed).
 */
export async function checkExistingActiveVial(branchId: number, variantId: number): Promise<any | null> {
  return prisma.vialSession.findFirst({
    where: {
      branchId,
      variantId,
      status: { in: ["ACTIVE", "PARTIALLY_USED"] },
      validUntil: { gt: new Date() },
    },
    orderBy: { openedAt: "desc" },
    include: {
      variant: { select: { id: true, title: true } },
      openedBy: { select: { id: true }, profile: { select: { displayName: true } } },
    },
  });
}

/**
 * Throw if there is an unresolved prior vial for this variant at branch (when policy requires return).
 */
export async function blockIfUnresolvedPrior(branchId: number, variantId: number): Promise<void> {
  const policy = await medicinePolicy.getPolicyWithDefaults(variantId);
  if (!policy.returnRequired) return;
  const active = await checkExistingActiveVial(branchId, variantId);
  if (active) {
    throw new Error(
      `Cannot issue new vial: active open vial exists for this medicine (session id ${active.id}). Return or exhaust current vial first.`
    );
  }
}

export type IssueItemInput = {
  requestItemId: number;
  issuedQty: number;
  vialInstanceId?: number | null;
};

/**
 * Issue items for an approved request: deduct stock via ledger (SALE_CLINIC), optionally create VialInstance.
 * Enforces: no new issue if prior unresolved vial (when return required).
 * locationId must be the pharmacy/clinic fulfilment location for the branch.
 */
export async function issueItems(
  requestId: number,
  locationId: number,
  items: IssueItemInput[],
  issuedByUserId: number
): Promise<any> {
  const req = await prisma.dispenseRequest.findUnique({
    where: { id: requestId },
    include: { items: true, branch: { select: { id: true } } },
  });
  if (!req || req.status !== "APPROVED") throw new Error("Request not found or not approved");
  const branchId = req.branchId;

  for (const item of req.items) {
    const issue = items.find((i) => i.requestItemId === item.id);
    if (!issue || issue.issuedQty <= 0) continue;
    await blockIfUnresolvedPrior(branchId, item.variantId);
  }

  const result = await prisma.$transaction(async (tx) => {
    const updates: Promise<any>[] = [];
    for (const issue of items) {
      const reqItem = req.items.find((i) => i.id === issue.requestItemId);
      if (!reqItem || issue.issuedQty <= 0) continue;
      if (issue.issuedQty > reqItem.requestedQty) {
        throw new Error(`Issued qty ${issue.issuedQty} exceeds requested ${reqItem.requestedQty}`);
      }
      // Deduct stock
      await ledger.saleFEFOInTx(tx as any, {
        locationId,
        variantId: reqItem.variantId,
        quantity: issue.issuedQty,
        saleType: "SALE_CLINIC",
        refType: "DISPENSE_REQUEST",
        refId: String(requestId),
        createdByUserId: issuedByUserId,
      });
      const policy = await medicinePolicy.getPolicy(reqItem.variantId);
      let vialInstanceId: number | null = issue.vialInstanceId ?? null;
      if (policy?.highRisk && !vialInstanceId) {
        const lot = await (tx as any).stockLot.findFirst({
          where: { variantId: reqItem.variantId },
          orderBy: { expDate: "asc" },
        });
        const vial = await (tx as any).vialInstance.create({
          data: {
            variantId: reqItem.variantId,
            lotId: lot?.id ?? null,
            batchCode: lot?.lotCode ?? null,
            serialCode: `V-${requestId}-${reqItem.id}-${Date.now()}`,
            branchId,
            locationId,
            orgId: req.orgId,
            status: "ISSUED",
            currentHolderType: "STAFF",
            currentHolderId: String(issuedByUserId),
          },
        });
        vialInstanceId = vial.id;
      }
      updates.push(
        (tx as any).dispenseRequestItem.update({
          where: { id: reqItem.id },
          data: {
            issuedQty: issue.issuedQty,
            vialInstanceId,
          },
        })
      );
    }
    await Promise.all(updates);
    const newStatus = req.items.every((i) => {
      const issue = items.find((x) => x.requestItemId === i.id);
      const qty = issue?.issuedQty ?? 0;
      return qty >= i.requestedQty;
    })
      ? "ISSUED"
      : "PARTIALLY_ISSUED";
    return (tx as any).dispenseRequest.update({
      where: { id: requestId },
      data: { status: newStatus },
      include: {
        items: {
          include: {
            variant: { select: { id: true, title: true, sku: true } },
            vialInstance: true,
          },
        },
      },
    });
  });
  return result;
}

/**
 * List dispense requests for branch with filters.
 */
export async function listRequests(
  branchId: number,
  opts?: { status?: string; visitId?: number; skip?: number; take?: number }
): Promise<{ list: any[]; total: number }> {
  const where: any = { branchId };
  if (opts?.status) where.status = opts.status;
  if (opts?.visitId != null) where.visitId = opts.visitId;
  const [list, total] = await Promise.all([
    prisma.dispenseRequest.findMany({
      where,
      skip: opts?.skip ?? 0,
      take: Math.min(opts?.take ?? 50, 100),
      include: {
        items: { include: { variant: { select: { id: true, title: true, sku: true } }, vialInstance: true } },
        requestedBy: { select: { id: true }, profile: { select: { displayName: true } } },
        visit: { select: { id: true, treatmentCode: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.dispenseRequest.count({ where }),
  ]);
  return { list, total };
}

export async function getRequestById(requestId: number, branchId: number): Promise<any | null> {
  return prisma.dispenseRequest.findFirst({
    where: { id: requestId, branchId },
    include: {
      items: { include: { variant: true, vialInstance: true } },
      requestedBy: { select: { id: true }, profile: { select: { displayName: true } } },
      visit: true,
    },
  });
}
