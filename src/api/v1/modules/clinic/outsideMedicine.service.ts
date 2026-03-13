/**
 * Outside Medicine Service — pharmacy verification (receive entry, batch/expiry) before injection.
 * OUTSIDE medicine cannot merge with clinic vial; injection requires valid token + verification.
 */
import prisma from "../../../../infrastructure/db/prismaClient";

export type RecordOutsideReceiveInput = {
  branchId: number;
  variantId: number;
  receivedByUserId: number;
  batchCode?: string | null;
  expiryDate?: Date | string | null;
};

/**
 * Record pharmacy receive of outside medicine (verification entry). Required before administration with source OUTSIDE.
 */
export async function recordOutsideReceive(data: RecordOutsideReceiveInput): Promise<any> {
  const expiry = data.expiryDate ? new Date(data.expiryDate) : null;
  return prisma.outsideMedicineReceive.create({
    data: {
      branchId: data.branchId,
      variantId: data.variantId,
      receivedByUserId: data.receivedByUserId,
      batchCode: data.batchCode ?? null,
      expiryDate: expiry,
    },
    include: {
      variant: { select: { id: true, title: true, sku: true } },
      receivedBy: { select: { id: true }, profile: { select: { displayName: true } } },
      branch: { select: { id: true, name: true } },
    },
  });
}

/** Check if there is a valid outside receive for this branch+variant (not expired, within validity window). */
export async function hasValidOutsideReceive(
  branchId: number,
  variantId: number,
  options?: { maxReceiveAgeDays?: number }
): Promise<boolean> {
  const maxDays = options?.maxReceiveAgeDays ?? 90;
  const since = new Date();
  since.setDate(since.getDate() - maxDays);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const count = await prisma.outsideMedicineReceive.count({
    where: {
      branchId,
      variantId,
      receivedAt: { gte: since },
      OR: [{ expiryDate: null }, { expiryDate: { gte: todayEnd } }],
    },
  });
  return count > 0;
}
