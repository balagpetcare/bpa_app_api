/**
 * Open Vial Service (CCMLPA) — vial session lifecycle: open, dose, expire, close/return.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import * as medicinePolicy from "./medicinePolicy.service";
import * as dispenseControl from "./dispenseControl.service";
import { INJECTION_ROOM_TYPES } from "../../constants/roomConstants";
import type { VialEventType, VialSessionStatus } from "@prisma/client";

/**
 * Open a vial: create VialSession, set validUntil from policy. If vialInstanceId provided, update its status.
 */
export async function openVial(
  params: {
    vialInstanceId?: number | null;
    variantId: number;
    lotId?: number | null;
    branchId: number;
    roomId?: number | null;
    openedByUserId: number;
    initialQty: number;
    requestedDose?: number | null;
    allowForceOpen?: boolean;
    openPhotoUrl?: string | null;
    activatedFromDispenseRequestId?: number | null; // internal order that triggered this activation
  }
): Promise<any> {
  // Enforcement: dispense request must be received before opening a vial activated from it.
  if (params.activatedFromDispenseRequestId != null) {
    await dispenseControl.requireDispenseRequestReceived(
      params.activatedFromDispenseRequestId,
      params.branchId
    );
  }

  // Vial activation only in injection room (or allowed room types).
  if (params.roomId != null) {
    const room = await prisma.branchRoom.findFirst({
      where: { id: params.roomId, branchId: params.branchId },
      select: { roomType: true },
    });
    if (!room) throw new Error("Room not found");
    if (!INJECTION_ROOM_TYPES.includes(room.roomType as any)) {
      throw new Error(`Vial activation is allowed only in injection room types: ${INJECTION_ROOM_TYPES.join(", ")}`);
    }
  }

  if (!params.allowForceOpen && params.requestedDose != null) {
    const active = await prisma.vialSession.findFirst({
      where: {
        branchId: params.branchId,
        variantId: params.variantId,
        status: { in: ["ACTIVE", "PARTIALLY_USED"] },
        validUntil: { gt: new Date() },
      },
      select: { id: true, remainingQty: true },
      orderBy: { openedAt: "desc" },
    });
    if (active && Number(active.remainingQty) >= Number(params.requestedDose)) {
      throw new Error(`Current vial has sufficient quantity (session ${active.id})`);
    }
  }

  const policy = await medicinePolicy.getPolicyWithDefaults(params.variantId);
  const validityHours = policy.openVialValidityHours ?? 24;
  const validUntil = new Date();
  validUntil.setHours(validUntil.getHours() + validityHours);

  const session = await prisma.$transaction(async (tx) => {
    const session = await (tx as any).vialSession.create({
      data: {
        vialInstanceId: params.vialInstanceId ?? null,
        variantId: params.variantId,
        lotId: params.lotId ?? null,
        branchId: params.branchId,
        roomId: params.roomId ?? null,
        openedByUserId: params.openedByUserId,
        validUntil,
        openPhotoUrl: params.openPhotoUrl ?? null,
        initialQty: params.initialQty,
        remainingQty: params.initialQty,
        status: "ACTIVE",
        activatedFromDispenseRequestId: params.activatedFromDispenseRequestId ?? null,
      },
    });
    await (tx as any).vialSessionEvent.create({
      data: {
        vialSessionId: session.id,
        eventType: "OPENED",
        quantityDelta: null,
        performedByUserId: params.openedByUserId,
        photoUrl: params.openPhotoUrl ?? null,
      },
    });
    if (params.vialInstanceId) {
      await (tx as any).vialInstance.update({
        where: { id: params.vialInstanceId },
        data: { status: "OPENED", currentHolderType: "ROOM", currentHolderId: params.roomId ? String(params.roomId) : null },
      });
    }
    return session;
  });

  return prisma.vialSession.findUnique({
    where: { id: session.id },
    include: {
      variant: { select: { id: true, title: true, sku: true } },
      room: { select: { id: true, name: true } },
      openedBy: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });
}

/**
 * Get active session for variant at branch (not expired, not exhausted/returned/destroyed).
 */
export async function getActiveSession(branchId: number, variantId: number): Promise<any | null> {
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
      room: { select: { id: true, name: true } },
      openedBy: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });
}

/**
 * Record a dose from a vial session: decrement remainingQty, create VialSessionEvent.
 */
export async function recordDose(
  sessionId: number,
  data: {
    quantityDelta: number; // negative (e.g. -2 for 2 ml used)
    performedByUserId?: number | null;
    witnessUserId?: number | null;
    photoUrl?: string | null;
    notes?: string | null;
  },
  tx?: any
): Promise<any> {
  const db = tx ?? prisma;
  const session = await db.vialSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      branchId: true,
      status: true,
      validUntil: true,
      remainingQty: true,
      initialQty: true,
      variantId: true,
      activatedFromDispenseRequestId: true,
    },
  });
  if (!session) throw new Error("Vial session not found");
  // Enforcement: dispense request must be received before using vial from that request.
  if (session.activatedFromDispenseRequestId != null) {
    await dispenseControl.requireDispenseRequestReceived(
      session.activatedFromDispenseRequestId,
      session.branchId
    );
  }
  if (session.status !== "ACTIVE" && session.status !== "PARTIALLY_USED") {
    throw new Error("Vial session is not active");
  }
  if (session.validUntil && new Date() > session.validUntil) {
    throw new Error("Vial session has expired");
  }
  const used = Math.abs(data.quantityDelta);
  if (used > session.remainingQty) throw new Error("Insufficient remaining quantity in vial");
  const newRemaining = session.remainingQty - used;
  const policy = await medicinePolicy.getPolicyWithDefaults(session.variantId);
  const minPct = policy.minRemainingPercent != null ? Number(policy.minRemainingPercent) : null;
  if (minPct != null && session.initialQty > 0) {
    const pctRemaining = (newRemaining / session.initialQty) * 100;
    if (pctRemaining < minPct) {
      throw new Error(
        `Minimum remaining threshold (${minPct}%) would be exceeded; current remaining would be ${pctRemaining.toFixed(1)}%`
      );
    }
  }
  const newStatus: VialSessionStatus = newRemaining <= 0 ? "EXHAUSTED" : "PARTIALLY_USED";

  if (tx) {
    await (tx as any).vialSessionEvent.create({
      data: {
        vialSessionId: sessionId,
        eventType: "DOSE_USED",
        quantityDelta: -used,
        performedByUserId: data.performedByUserId ?? null,
        witnessUserId: data.witnessUserId ?? null,
        photoUrl: data.photoUrl ?? null,
        notes: data.notes ?? null,
      },
    });
    await (tx as any).vialSession.update({
      where: { id: sessionId },
      data: { remainingQty: newRemaining, status: newStatus },
    });
  } else {
    await prisma.$transaction(async (tx2) => {
      await (tx2 as any).vialSessionEvent.create({
        data: {
          vialSessionId: sessionId,
          eventType: "DOSE_USED",
          quantityDelta: -used,
          performedByUserId: data.performedByUserId ?? null,
          witnessUserId: data.witnessUserId ?? null,
          photoUrl: data.photoUrl ?? null,
          notes: data.notes ?? null,
        },
      });
      await (tx2 as any).vialSession.update({
        where: { id: sessionId },
        data: { remainingQty: newRemaining, status: newStatus },
      });
    });
  }

  return prisma.vialSession.findUnique({
    where: { id: sessionId },
    include: {
      variant: { select: { id: true, title: true } },
      events: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
}

/**
 * Expire overdue sessions (cron). Set status to EXPIRED where validUntil < now.
 */
export async function expireOverdueSessions(): Promise<number> {
  const result = await prisma.vialSession.updateMany({
    where: {
      status: { in: ["ACTIVE", "PARTIALLY_USED"] },
      validUntil: { lt: new Date() },
    },
    data: { status: "EXPIRED" },
  });
  return result.count;
}

/**
 * Close a session (exhausted or returned). Optionally link return data for Phase 2.
 */
export async function closeSession(
  sessionId: number,
  data: { status: "EXHAUSTED" | "RETURNED"; returnPhotoUrl?: string | null; notes?: string | null }
): Promise<any> {
  const session = await prisma.vialSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error("Vial session not found");
  const allowed: VialSessionStatus[] = ["EXHAUSTED", "RETURNED"];
  if (!allowed.includes(data.status as VialSessionStatus)) throw new Error("Invalid close status");

  await prisma.$transaction(async (tx) => {
    await (tx as any).vialSessionEvent.create({
      data: {
        vialSessionId: sessionId,
        eventType: data.status === "RETURNED" ? "RETURNED" : "DESTROYED",
        quantityDelta: null,
        notes: data.notes ?? null,
        photoUrl: data.returnPhotoUrl ?? null,
      },
    });
    await (tx as any).vialSession.update({
      where: { id: sessionId },
      data: { status: data.status },
    });
    if (session.vialInstanceId) {
      await (tx as any).vialInstance.update({
        where: { id: session.vialInstanceId },
        data: { status: data.status === "RETURNED" ? "RETURNED" : "EXHAUSTED" },
      });
    }
  });

  return prisma.vialSession.findUnique({
    where: { id: sessionId },
    include: { variant: true },
  });
}

/**
 * List vial sessions for branch with optional filters.
 */
export async function listSessions(
  branchId: number,
  opts?: { status?: VialSessionStatus; variantId?: number; skip?: number; take?: number }
): Promise<{ list: any[]; total: number }> {
  const where: any = { branchId };
  if (opts?.status) where.status = opts.status;
  if (opts?.variantId) where.variantId = opts.variantId;
  const [list, total] = await Promise.all([
    prisma.vialSession.findMany({
      where,
      skip: opts?.skip ?? 0,
      take: Math.min(opts?.take ?? 50, 100),
      include: {
        variant: { select: { id: true, title: true, sku: true } },
        room: { select: { id: true, name: true } },
        openedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      },
      orderBy: { openedAt: "desc" },
    }),
    prisma.vialSession.count({ where }),
  ]);
  return { list, total };
}
