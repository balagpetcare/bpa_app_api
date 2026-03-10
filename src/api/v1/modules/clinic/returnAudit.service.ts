/**
 * Return Audit Service (CCMLPA) — submit vial return, assign to bin, verify, quarantine.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import * as medicinePolicy from "./medicinePolicy.service";
import type { VialReturnCondition, VialReturnVerificationStatus } from "@prisma/client";

export type SubmitReturnInput = {
  vialSessionId: number;
  returnedByUserId: number;
  condition: VialReturnCondition;
  approxRemainingQty?: number | null;
  returnPhotoUrl?: string | null;
  receivedByUserId?: number | null;
};

export async function submitReturn(data: SubmitReturnInput): Promise<any> {
  const session = await prisma.vialSession.findUnique({
    where: { id: data.vialSessionId },
    include: { variant: true },
  });
  if (!session) throw new Error("Vial session not found");
  if (session.status === "RETURNED") throw new Error("Session already returned");
  const policy = await medicinePolicy.getPolicyWithDefaults(session.variantId);
  const retentionDays = policy.retentionDays ?? 7;
  const retentionUntil = new Date();
  retentionUntil.setDate(retentionUntil.getDate() + retentionDays);
  const vialReturn = await prisma.vialReturn.create({
    data: {
      vialSessionId: data.vialSessionId,
      returnedByUserId: data.returnedByUserId,
      condition: data.condition,
      approxRemainingQty: data.approxRemainingQty ?? null,
      returnPhotoUrl: data.returnPhotoUrl ?? null,
      receivedByUserId: data.receivedByUserId ?? null,
      verificationStatus: "PENDING",
    },
    include: { vialSession: { include: { variant: true } } },
  });
  await prisma.vialSession.update({
    where: { id: data.vialSessionId },
    data: { status: "RETURNED" },
  });
  if (session.vialInstanceId) {
    await prisma.vialInstance.update({
      where: { id: session.vialInstanceId },
      data: { status: "RETURNED" },
    });
  }
  return vialReturn;
}

export async function assignToBin(returnId: number, auditBinId: number): Promise<any> {
  const vialReturn = await prisma.vialReturn.findUnique({
    where: { id: returnId },
    include: { auditBinItems: true },
  });
  if (!vialReturn) throw new Error("Vial return not found");
  if (vialReturn.auditBinItems?.length) throw new Error("Return already assigned to a bin");
  const bin = await prisma.auditBin.findUnique({
    where: { id: auditBinId },
  });
  if (!bin || bin.status !== "OPEN") throw new Error("Audit bin not found or not open");
  const session = await prisma.vialSession.findUnique({
    where: { id: vialReturn.vialSessionId },
    select: { variantId: true },
  });
  const policy = await medicinePolicy.getPolicyWithDefaults(session!.variantId);
  const retentionDays = policy.retentionDays ?? 7;
  const retentionUntil = new Date();
  retentionUntil.setDate(retentionUntil.getDate() + retentionDays);
  const item = await prisma.auditBinItem.create({
    data: {
      auditBinId,
      vialReturnId: returnId,
      retentionUntil,
    },
    include: { auditBin: true, vialReturn: { include: { vialSession: { include: { variant: true } } } } },
  });
  await prisma.auditBin.update({
    where: { id: auditBinId },
    data: { currentItemCount: { increment: 1 } },
  });
  return item;
}

export async function verifyReturn(returnId: number, verifierUserId: number): Promise<any> {
  return prisma.vialReturn.update({
    where: { id: returnId },
    data: { verificationStatus: "VERIFIED", receivedByUserId: verifierUserId },
    include: { vialSession: { include: { variant: true } } },
  });
}

export async function quarantineReturn(returnId: number, reason?: string): Promise<any> {
  return prisma.vialReturn.update({
    where: { id: returnId },
    data: { verificationStatus: "QUARANTINED" },
    include: { vialSession: { include: { variant: true } } },
  });
}
