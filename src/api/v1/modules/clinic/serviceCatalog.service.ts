/**
 * Service catalog: auto serviceCode generation and species pricing variants.
 * Pattern: {CATEGORY_PREFIX}-{BRANCH_SHORT}-{AUTO_INCREMENT}
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");

const CATEGORY_PREFIX: Record<string, string> = {
  CONSULTATION: "CONS",
  VACCINATION: "VAC",
  SURGERY: "SUR",
  GROOMING: "GRM",
  BOARDING: "BRD",
  DIAGNOSTICS: "DIA",
  EMERGENCY: "EMR",
  TEST: "TEST",
  PROCEDURE: "PROC",
  PHARMACY: "PHA",
  OTHER: "OTH",
};

/**
 * Generate next service code for a branch. Format: {PREFIX}-{BRANCH_SHORT}-{SEQ}
 * Branch short: first 5 chars of branch name (uppercase, alphanumeric) or "BR" + branchId.
 */
async function generateServiceCode(branchId: number, category: string): Promise<string> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { id: true, name: true },
  });
  if (!branch) throw new Error("Branch not found");

  const prefix = CATEGORY_PREFIX[category] || "OTH";
  const branchShort = (branch.name || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 5) || `BR${branchId}`;

  const pattern = `${prefix}-${branchShort}-%`;
  const prefixMatch = `${prefix}-${branchShort}-`;
  const last = await prisma.service.findFirst({
    where: {
      branchId,
      serviceCode: { not: null, startsWith: prefixMatch },
    },
    orderBy: { serviceCode: "desc" },
    select: { serviceCode: true },
  });

  let seq = 1;
  if (last?.serviceCode) {
    const match = last.serviceCode.match(/-(\d+)$/);
    if (match) seq = parseInt(match[1], 10) + 1;
  }
  const code = `${prefix}-${branchShort}-${String(seq).padStart(3, "0")}`;
  return code;
}

/**
 * Get pricing variants for a service.
 */
async function getServicePricingVariants(serviceId: number, branchId: number): Promise<any[]> {
  const service = await prisma.service.findFirst({
    where: { id: serviceId, branchId },
    select: { id: true },
  });
  if (!service) throw new Error("Service not found");

  const variants = await prisma.servicePricingVariant.findMany({
    where: { serviceId },
    orderBy: [{ species: "asc" }, { sex: "asc" }],
  });
  return variants.map((v) => ({
    id: v.id,
    serviceId: v.serviceId,
    species: v.species,
    sex: v.sex,
    price: v.price != null ? Number(v.price) : null,
    isActive: v.isActive,
  }));
}

/**
 * Replace all pricing variants for a service.
 */
async function putServicePricingVariants(
  serviceId: number,
  branchId: number,
  variants: Array<{ species: string; sex?: string | null; price: number; isActive?: boolean }>
): Promise<any[]> {
  const service = await prisma.service.findFirst({
    where: { id: serviceId, branchId },
    select: { id: true },
  });
  if (!service) throw new Error("Service not found");

  await prisma.servicePricingVariant.deleteMany({ where: { serviceId } });

  if (!variants || variants.length === 0) return [];

  await prisma.servicePricingVariant.createMany({
    data: variants.map((v) => ({
      serviceId,
      species: v.species,
      sex: v.sex ?? null,
      price: v.price,
      isActive: v.isActive !== false,
    })),
  });
  const created = await prisma.servicePricingVariant.findMany({
    where: { serviceId },
    orderBy: [{ species: "asc" }, { sex: "asc" }],
  });
  return created.map((v) => ({
    id: v.id,
    serviceId: v.serviceId,
    species: v.species,
    sex: v.sex,
    price: v.price != null ? Number(v.price) : null,
    isActive: v.isActive,
  }));
}

module.exports = {
  generateServiceCode,
  getServicePricingVariants,
  putServicePricingVariants,
  CATEGORY_PREFIX,
};
