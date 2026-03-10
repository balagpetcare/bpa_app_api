/**
 * Clinic Finance Config: per-branch configuration for settlement cycle,
 * discount limits, overhead allocation, case completion rules, vial return days, etc.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");

export type SettlementCycle = "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";

/** Get finance config for branch (create default if missing) */
export async function getFinanceConfig(branchId: number) {
  let config = await prisma.clinicFinanceConfig.findUnique({
    where: { branchId },
  });
  if (!config) {
    config = await prisma.clinicFinanceConfig.create({
      data: {
        branchId,
        settlementCycle: "MONTHLY",
        vialReturnDays: 7,
        stockIssueAuditLock: false,
        billEditRestrictionAfterClose: true,
        doctorFeeEditRestricted: true,
      },
    });
  }
  return config;
}

/** Update finance config */
export async function updateFinanceConfig(
  branchId: number,
  data: {
    settlementCycle?: SettlementCycle;
    discountLimitDefaultPct?: number | null;
    overheadAllocationMethod?: string | null;
    caseCompletionRule?: string | null;
    vialReturnDays?: number | null;
    stockIssueAuditLock?: boolean;
    billEditRestrictionAfterClose?: boolean;
    doctorFeeEditRestricted?: boolean;
    configJson?: object | null;
  }
) {
  const existing = await prisma.clinicFinanceConfig.findUnique({
    where: { branchId },
  });

  const updateData: Record<string, unknown> = {};
  if (data.settlementCycle != null) updateData.settlementCycle = data.settlementCycle;
  if (data.discountLimitDefaultPct !== undefined)
    updateData.discountLimitDefaultPct = data.discountLimitDefaultPct;
  if (data.overheadAllocationMethod !== undefined)
    updateData.overheadAllocationMethod = data.overheadAllocationMethod;
  if (data.caseCompletionRule !== undefined)
    updateData.caseCompletionRule = data.caseCompletionRule;
  if (data.vialReturnDays !== undefined) updateData.vialReturnDays = data.vialReturnDays;
  if (data.stockIssueAuditLock != null)
    updateData.stockIssueAuditLock = data.stockIssueAuditLock;
  if (data.billEditRestrictionAfterClose != null)
    updateData.billEditRestrictionAfterClose = data.billEditRestrictionAfterClose;
  if (data.doctorFeeEditRestricted != null)
    updateData.doctorFeeEditRestricted = data.doctorFeeEditRestricted;
  if (data.configJson !== undefined) updateData.configJson = data.configJson;

  if (existing) {
    return prisma.clinicFinanceConfig.update({
      where: { branchId },
      data: updateData,
    });
  }

  return prisma.clinicFinanceConfig.create({
    data: {
      branchId,
      settlementCycle: (data.settlementCycle as SettlementCycle) ?? "MONTHLY",
      discountLimitDefaultPct: data.discountLimitDefaultPct ?? undefined,
      overheadAllocationMethod: data.overheadAllocationMethod ?? undefined,
      caseCompletionRule: data.caseCompletionRule ?? undefined,
      vialReturnDays: data.vialReturnDays ?? 7,
      stockIssueAuditLock: data.stockIssueAuditLock ?? false,
      billEditRestrictionAfterClose: data.billEditRestrictionAfterClose ?? true,
      doctorFeeEditRestricted: data.doctorFeeEditRestricted ?? true,
      configJson: data.configJson ?? undefined,
    },
  });
}
