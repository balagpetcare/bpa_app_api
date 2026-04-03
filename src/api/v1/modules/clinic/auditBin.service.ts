/**
 * Audit Bin Service (CCMLPA) — create bin, seal, list, destruction list, record destruction.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import type { AuditBinType, AuditBinStatus } from "@prisma/client";

export type CreateBinInput = {
  branchId: number;
  binType: AuditBinType;
  roomId?: number | null;
};

export async function createBin(data: CreateBinInput): Promise<any> {
  return prisma.auditBin.create({
    data: {
      branchId: data.branchId,
      roomId: data.roomId ?? null,
      binType: data.binType,
      status: "OPEN",
    },
    include: { branch: { select: { id: true, name: true } }, room: { select: { id: true, name: true } } },
  });
}

export async function sealBin(binId: number, sealNo: string): Promise<any> {
  const bin = await prisma.auditBin.findUnique({ where: { id: binId } });
  if (!bin || bin.status !== "OPEN") throw new Error("Bin not found or not open");
  return prisma.auditBin.update({
    where: { id: binId },
    data: { sealNo, closeDate: new Date(), status: "SEALED" },
    include: { items: { include: { vialReturn: true } } },
  });
}

export async function listBins(
  branchId: number,
  opts?: { binType?: AuditBinType; status?: AuditBinStatus; skip?: number; take?: number }
): Promise<{ list: any[]; total: number }> {
  const where: any = { branchId };
  if (opts?.binType) where.binType = opts.binType;
  if (opts?.status) where.status = opts.status;
  const [list, total] = await Promise.all([
    prisma.auditBin.findMany({
      where,
      skip: opts?.skip ?? 0,
      take: Math.min(opts?.take ?? 50, 100),
      include: { room: { select: { id: true, name: true } }, _count: { select: { items: true } } },
      orderBy: { startDate: "desc" },
    }),
    prisma.auditBin.count({ where }),
  ]);
  return { list, total };
}

export async function generateDestructionList(branchId: number): Promise<any[]> {
  const now = new Date();
  const items = await prisma.auditBinItem.findMany({
    where: {
      auditBin: { branchId },
      itemStatus: "HELD",
      retentionUntil: { lte: now },
    },
    include: {
      auditBin: { select: { id: true, binType: true, sealNo: true } },
      vialReturn: { include: { vialSession: { include: { variant: true } } } },
    },
  });
  return items;
}

export type RecordDestructionInput = {
  auditBinId: number;
  destroyedByUserId: number;
  witnessUserId?: number | null;
  approvalRequestId?: number | null;
  itemCount: number;
  photoUrl?: string | null;
};

export async function recordDestruction(data: RecordDestructionInput): Promise<any> {
  return prisma.destructionRecord.create({
    data: {
      auditBinId: data.auditBinId,
      destroyedByUserId: data.destroyedByUserId,
      witnessUserId: data.witnessUserId ?? null,
      approvalRequestId: data.approvalRequestId ?? null,
      itemCount: data.itemCount,
      photoUrl: data.photoUrl ?? null,
    },
    include: {
      auditBin: true,
      destroyedBy: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });
}
