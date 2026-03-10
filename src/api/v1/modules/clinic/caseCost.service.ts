/**
 * Case Cost Sheet: build per-case cost breakdown (direct cost, semi-direct, overhead,
 * distributable margin, doctor/clinic/support share).
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");

/** Build or update case cost sheet from clinical case data */
export async function buildCaseCostSheet(clinicalCaseId: number): Promise<{
  id: number;
  directCost: number;
  semiDirectCost: number | null;
  overheadAllocated: number | null;
  distributableMargin: number;
  doctorShare: number | null;
  clinicShare: number | null;
  supportShare: number | null;
}> {
  const c = await prisma.clinicalCase.findUnique({
    where: { id: clinicalCaseId },
    include: {
      surgeryPackage: true,
      procedureOrders: {
        where: { status: "COMPLETED" },
        include: { surgeryPackage: true },
      },
    },
  });
  if (!c) throw new Error("Clinical case not found");

  const totalCharges = Number(c.totalCollected ?? c.totalCharges ?? 0);
  if (totalCharges <= 0) {
    const existing = await prisma.caseCostSheet.findFirst({
      where: { clinicalCaseId },
      orderBy: { id: "desc" },
    });
    const zeroData = {
      directCost: 0,
      semiDirectCost: 0,
      overheadAllocated: 0,
      distributableMargin: 0,
      doctorShare: 0,
      clinicShare: 0,
      supportShare: 0,
    };
    if (existing) {
      const zeroSheet = await prisma.caseCostSheet.update({
        where: { id: existing.id },
        data: zeroData,
      });
      return zeroSheet as Awaited<ReturnType<typeof buildCaseCostSheet>>;
    }
    const zeroSheet = await prisma.caseCostSheet.create({
      data: { clinicalCaseId, ...zeroData },
    });
    return zeroSheet as Awaited<ReturnType<typeof buildCaseCostSheet>>;
  }

  let directCost = 0;
  let doctorShare = 0;
  let clinicShare = 0;
  let supportShare = 0;

  if (c.surgeryPackage) {
    const pkg = c.surgeryPackage;
    directCost =
      Number(pkg.consumableBlockAmount ?? 0) +
      Number(pkg.medicationBlockAmount ?? 0);
    doctorShare = Number(pkg.doctorFeeAmount ?? 0);
    clinicShare = Number(pkg.clinicFeeAmount ?? 0);
    supportShare = Number(pkg.supportFeeAmount ?? 0);
  } else {
    for (const order of c.procedureOrders) {
      const pkg = order.surgeryPackage;
      if (pkg) {
        directCost +=
          Number(pkg.consumableBlockAmount ?? 0) +
          Number(pkg.medicationBlockAmount ?? 0);
        doctorShare += Number(pkg.doctorFeeAmount ?? 0);
        clinicShare += Number(pkg.clinicFeeAmount ?? 0);
        supportShare += Number(pkg.supportFeeAmount ?? 0);
      }
    }
  }

  const semiDirectCost = 0;
  const overheadAllocated = 0;
  const distributableMargin = totalCharges - directCost;

  const snapshot = {
    totalCharges,
    directCost,
    semiDirectCost,
    overheadAllocated,
    distributableMargin,
    doctorShare,
    clinicShare,
    supportShare,
  };

  const existing = await prisma.caseCostSheet.findFirst({
    where: { clinicalCaseId },
    orderBy: { id: "desc" },
  });

  const sheet = existing
    ? await prisma.caseCostSheet.update({
        where: { id: existing.id },
        data: {
          directCost,
          semiDirectCost,
          overheadAllocated,
          distributableMargin,
          doctorShare,
          clinicShare,
          supportShare,
          snapshotJson: snapshot,
        },
      })
    : await prisma.caseCostSheet.create({
        data: {
          clinicalCaseId,
          directCost,
          semiDirectCost,
          overheadAllocated,
          distributableMargin,
          doctorShare,
          clinicShare,
          supportShare,
          snapshotJson: snapshot,
        },
      });

  return {
    id: sheet.id,
    directCost: Number(sheet.directCost),
    semiDirectCost: sheet.semiDirectCost != null ? Number(sheet.semiDirectCost) : null,
    overheadAllocated:
      sheet.overheadAllocated != null ? Number(sheet.overheadAllocated) : null,
    distributableMargin: Number(sheet.distributableMargin),
    doctorShare: sheet.doctorShare != null ? Number(sheet.doctorShare) : null,
    clinicShare: sheet.clinicShare != null ? Number(sheet.clinicShare) : null,
    supportShare: sheet.supportShare != null ? Number(sheet.supportShare) : null,
  };
}

/** Get case cost sheet for a clinical case */
export async function getCaseCostSheet(clinicalCaseId: number) {
  const sheet = await prisma.caseCostSheet.findFirst({
    where: { clinicalCaseId },
  });
  return sheet;
}
