/**
 * Lab & diagnostics: requisition, report upload/entry, abnormal flags.
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");

async function createRequisition(branchId: number, data: { visitId: number; petId: number; testsJson: any; notes?: string }): Promise<any> {
  return prisma.labRequisition.create({
    data: {
      visitId: data.visitId,
      branchId,
      petId: data.petId,
      testsJson: data.testsJson ?? [],
      status: "PENDING",
      notes: data.notes ?? null,
    },
    include: { visit: { select: { id: true } } },
  });
}

async function listRequisitionsByVisit(visitId: number): Promise<any[]> {
  return prisma.labRequisition.findMany({
    where: { visitId },
    include: { reports: { include: { items: true } } },
    orderBy: { createdAt: "desc" },
  });
}

async function addReport(requisitionId: number, data: { fileUrl?: string; abnormalFlags?: any; notes?: string; items?: { testCode: string; testName: string; value?: string; unit?: string; referenceRange?: string; isAbnormal?: boolean }[] }): Promise<any> {
  const report = await prisma.labReport.create({
    data: {
      requisitionId,
      fileUrl: data.fileUrl ?? null,
      abnormalFlags: data.abnormalFlags ?? null,
      notes: data.notes ?? null,
      items: data.items?.length ? { create: data.items } : undefined,
    },
    include: { items: true },
  });
  await prisma.labRequisition.update({ where: { id: requisitionId }, data: { status: "RESULT_ENTERED" } });
  return report;
}

module.exports = { createRequisition, listRequisitionsByVisit, addReport };
