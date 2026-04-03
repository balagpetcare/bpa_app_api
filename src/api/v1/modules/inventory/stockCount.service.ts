/**
 * Stock Count (Cycle Count) service.
 * Session: DRAFT → FROZEN (snapshot system qty) → SUBMITTED → POSTED (ADJUSTMENT ledger entries).
 */
import prisma from "../../../../infrastructure/db/prismaClient";
const ledgerService = require("./ledger.service");

export type CreateStockCountInput = {
  orgId: number;
  locationId: number;
  note?: string;
  createdByUserId?: number;
};

export async function createStockCount(data: CreateStockCountInput) {
  const location = await prisma.inventoryLocation.findUnique({
    where: { id: data.locationId },
    include: { branch: true },
  });
  if (!location || location.branch.orgId !== data.orgId) {
    throw new Error("Location not found or does not belong to organization");
  }
  const session = await prisma.stockCountSession.create({
    data: {
      orgId: data.orgId,
      locationId: data.locationId,
      status: "DRAFT",
      note: data.note ?? null,
      createdByUserId: data.createdByUserId ?? null,
    },
    include: {
      location: { select: { id: true, name: true } },
    },
  });
  return session;
}

/**
 * Freeze: snapshot current system quantities from StockBalance (variant-level; lot-level optional later).
 * Sets status to FROZEN and creates StockCountLine rows with systemQty, countedQty=0, varianceQty=0.
 */
export async function freezeStockCount(sessionId: number, orgId: number) {
  const session = await prisma.stockCountSession.findUnique({
    where: { id: sessionId },
    include: { location: true },
  });
  if (!session || session.orgId !== orgId) throw new Error("Stock count session not found");
  if (session.status !== "DRAFT") throw new Error(`Session is already ${session.status}`);

  const balances = await prisma.stockBalance.findMany({
    where: { locationId: session.locationId, onHandQty: { gt: 0 } },
    select: { variantId: true, onHandQty: true },
  });

  await prisma.$transaction(async (tx: any) => {
    for (const b of balances) {
      await tx.stockCountLine.upsert({
        where: {
          sessionId_variantId: {
            sessionId,
            variantId: b.variantId,
          },
        },
        create: {
          sessionId,
          variantId: b.variantId,
          lotId: null,
          systemQty: b.onHandQty,
          countedQty: 0,
          varianceQty: 0,
        },
        update: {
          systemQty: b.onHandQty,
          countedQty: 0,
          varianceQty: 0,
        },
      });
    }
    await tx.stockCountSession.update({
      where: { id: sessionId },
      data: { status: "FROZEN", frozenAt: new Date() },
    });
  });

  return prisma.stockCountSession.findUnique({
    where: { id: sessionId },
    include: {
      location: { select: { id: true, name: true } },
      lines: { include: { variant: { select: { id: true, sku: true, title: true } } } },
    },
  });
}

export type UpsertLinesInput = Array<{
  variantId: number;
  lotId?: number | null;
  countedQty: number;
}>;

/**
 * Bulk upsert counted quantities. Session must be FROZEN.
 * Recomputes varianceQty = countedQty - systemQty per line.
 */
export async function upsertCountLines(sessionId: number, orgId: number, lines: UpsertLinesInput) {
  const session = await prisma.stockCountSession.findUnique({
    where: { id: sessionId },
    include: { lines: true },
  });
  if (!session || session.orgId !== orgId) throw new Error("Stock count session not found");
  if (session.status !== "FROZEN") throw new Error(`Session must be FROZEN to update counts; current: ${session.status}`);

  const locationId = session.locationId;
  for (const line of lines) {
    const existing = await prisma.stockCountLine.findUnique({
      where: {
        sessionId_variantId: { sessionId, variantId: line.variantId },
      },
    });
    const systemQty = existing?.systemQty ?? (await prisma.stockBalance.findUnique({
      where: { locationId_variantId: { locationId, variantId: line.variantId } },
      select: { onHandQty: true },
    }))?.onHandQty ?? 0;
    const varianceQty = line.countedQty - systemQty;
    await prisma.stockCountLine.upsert({
      where: {
        sessionId_variantId: { sessionId, variantId: line.variantId },
      },
      create: {
        sessionId,
        variantId: line.variantId,
        lotId: line.lotId ?? null,
        systemQty,
        countedQty: line.countedQty,
        varianceQty,
      },
      update: {
        countedQty: line.countedQty,
        varianceQty,
      },
    });
  }

  return prisma.stockCountSession.findUnique({
    where: { id: sessionId },
    include: {
      location: { select: { id: true, name: true } },
      lines: { include: { variant: { select: { id: true, sku: true, title: true } }, lot: { select: { id: true, lotCode: true } } } },
    },
  });
}

/**
 * Post: create ADJUSTMENT ledger entries for all lines with non-zero variance in one transaction.
 * Marks session as POSTED. Idempotent: no-op if already POSTED.
 */
export async function postStockCount(sessionId: number, orgId: number, userId: number) {
  const session = await prisma.stockCountSession.findUnique({
    where: { id: sessionId },
    include: { lines: true, location: true },
  });
  if (!session || session.orgId !== orgId) throw new Error("Stock count session not found");
  if (session.status === "POSTED") return prisma.stockCountSession.findUnique({ where: { id: sessionId }, include: { lines: true, location: true } });
  if (session.status !== "FROZEN" && session.status !== "SUBMITTED") {
    throw new Error(`Session must be FROZEN or SUBMITTED to post; current: ${session.status}`);
  }

  const linesWithVariance = session.lines.filter((l) => l.varianceQty !== 0);
  await prisma.$transaction(async (tx: any) => {
    for (const line of linesWithVariance) {
      await ledgerService.recordLedgerEntryInTx(tx, {
        orgId,
        locationId: session.locationId,
        variantId: line.variantId,
        lotId: line.lotId ?? undefined,
        type: "ADJUSTMENT",
        quantityDelta: line.varianceQty,
        refType: "STOCK_COUNT",
        refId: String(sessionId),
        createdByUserId: userId,
      });
    }
    await tx.stockCountSession.update({
      where: { id: sessionId },
      data: { status: "POSTED", postedAt: new Date() },
    });
  });

  return prisma.stockCountSession.findUnique({
    where: { id: sessionId },
    include: {
      location: { select: { id: true, name: true } },
      lines: { include: { variant: { select: { id: true, sku: true, title: true } } } },
    },
  });
}

export async function listStockCounts(orgId: number, locationId?: number, status?: string) {
  const where: any = { orgId };
  if (locationId) where.locationId = locationId;
  if (status) where.status = status;
  const items = await prisma.stockCountSession.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      location: { select: { id: true, name: true } },
      createdBy: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });
  return items;
}

export async function getStockCountById(sessionId: number, orgId: number) {
  const row = await prisma.stockCountSession.findUnique({
    where: { id: sessionId },
    include: {
      location: { select: { id: true, name: true } },
      lines: { include: { variant: { select: { id: true, sku: true, title: true } }, lot: { select: { id: true, lotCode: true } } } },
      createdBy: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });
  if (!row || row.orgId !== orgId) return null;
  return row;
}
