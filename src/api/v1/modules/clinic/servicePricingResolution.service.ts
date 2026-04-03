/**
 * Centralized list price and doctor fee resolution for appointments, billing UX, and consultation snapshots.
 * Appointments store doctorId as BranchMember.id — map to ClinicStaffProfile.id before reading DoctorServiceFee.
 */

const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");

export type ListPriceContext = { species?: string | null; sex?: string | null };

function num(d: unknown): number {
  if (d == null) return 0;
  const n = Number(d);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Resolve ClinicStaffProfile.id for a doctor BranchMember in a branch.
 */
export async function resolveClinicStaffProfileId(
  branchId: number,
  branchMemberId: number | null | undefined
): Promise<number | null> {
  if (branchMemberId == null || !Number.isFinite(branchMemberId)) return null;
  const profile = await prisma.clinicStaffProfile.findFirst({
    where: { branchId, branchMemberId, staffType: "DOCTOR" },
    select: { id: true },
  });
  return profile?.id ?? null;
}

/**
 * Default list/sell price: variant match (species/sex) if active, else Service.price.
 */
export function resolveServiceListPriceFromRows(
  service: { price: unknown; pricingVariants?: Array<{ species: string; sex: string | null; price: unknown; isActive: boolean }> },
  ctx?: ListPriceContext
): number {
  const variants = service.pricingVariants;
  if (variants?.length && ctx?.species) {
    const sex = ctx.sex ?? null;
    const match = variants.find(
      (v) =>
        v.isActive !== false &&
        v.species === ctx.species &&
        (v.sex == null || v.sex === sex || sex == null)
    );
    if (match) return num(match.price);
  }
  return num(service.price);
}

export async function getServiceWithVariantsForBranch(serviceId: number, branchId: number) {
  return prisma.service.findFirst({
    where: { id: serviceId, branchId },
    include: { pricingVariants: true },
  });
}

/**
 * Doctor take from DoctorServiceFee row using feeModel (legacy fee = fixed when fixedAmount null).
 */
export function computeDoctorFeeAmountFromRow(
  row: {
    fee: unknown;
    feeModel?: string;
    feePercent?: unknown;
    fixedAmount?: unknown;
  },
  listPrice: number
): number {
  const fixed = row.fixedAmount != null ? num(row.fixedAmount) : num(row.fee);
  const pct = row.feePercent != null ? num(row.feePercent) : 0;
  const model = row.feeModel || "FIXED";
  if (model === "PERCENT_OF_LIST") {
    return Math.round((listPrice * pct) / 100 * 100) / 100;
  }
  if (model === "HYBRID") {
    return Math.round((fixed + (listPrice * pct) / 100) * 100) / 100;
  }
  return fixed;
}

export async function resolveDoctorServiceFeeAmount(options: {
  branchId: number;
  branchMemberId: number | null | undefined;
  serviceId: number;
  species?: string | null;
}): Promise<{ amount: number | null; profileId: number | null; feeRowId: number | null }> {
  const profileId = await resolveClinicStaffProfileId(options.branchId, options.branchMemberId);
  if (profileId == null) return { amount: null, profileId: null, feeRowId: null };

  const service = await getServiceWithVariantsForBranch(options.serviceId, options.branchId);
  if (!service) return { amount: null, profileId, feeRowId: null };

  const listPrice = resolveServiceListPriceFromRows(service, { species: options.species ?? undefined });

  let feeRow = null;
  if (options.species) {
    feeRow = await prisma.doctorServiceFee.findFirst({
      where: {
        clinicStaffProfileId: profileId,
        serviceId: options.serviceId,
        isActive: true,
        species: options.species,
      },
    });
  }
  if (!feeRow) {
    feeRow = await prisma.doctorServiceFee.findFirst({
      where: {
        clinicStaffProfileId: profileId,
        serviceId: options.serviceId,
        isActive: true,
        species: null,
      },
    });
  }

  if (!feeRow) return { amount: null, profileId, feeRowId: null };

  const amount = computeDoctorFeeAmountFromRow(feeRow, listPrice);
  if (amount <= 0) return { amount: null, profileId, feeRowId: feeRow.id };

  return { amount, profileId, feeRowId: feeRow.id };
}
