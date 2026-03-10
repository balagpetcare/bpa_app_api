/**
 * Vet reference data: countries, regulatory bodies, required doc types.
 * Public read-only; used by doctor verification form and admin panel.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");

async function listCountries() {
  return prisma.vetCountry.findMany({
    where: { isActive: true },
    orderBy: [{ region: "asc" }, { name: "asc" }],
    select: { id: true, code: true, name: true, region: true, hasVetLicensing: true },
  });
}

async function getBodiesByCountryCode(countryCode: string) {
  const country = await prisma.vetCountry.findUnique({
    where: { code: String(countryCode).trim().toUpperCase(), isActive: true },
    select: { id: true },
  });
  if (!country) return [];
  return prisma.vetRegulatoryBody.findMany({
    where: { countryId: country.id, isActive: true },
    orderBy: [{ bodyType: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      abbreviation: true,
      bodyType: true,
      jurisdiction: true,
      websiteUrl: true,
      verificationUrl: true,
      verificationMethod: true,
      contactEmail: true,
      contactPhone: true,
      licenseFormat: true,
      notes: true,
    },
  });
}

async function getDocTypesByBodyId(bodyId: number) {
  return prisma.vetRequiredDocType.findMany({
    where: { regulatoryBodyId: Number(bodyId) },
    orderBy: { sortOrder: "asc" },
    select: { id: true, documentType: true, label: true, description: true, isRequired: true, sortOrder: true },
  });
}

async function getBodyById(bodyId: number) {
  return prisma.vetRegulatoryBody.findUnique({
    where: { id: Number(bodyId), isActive: true },
    include: {
      country: { select: { id: true, code: true, name: true, region: true } },
      requiredDocTypes: { orderBy: { sortOrder: "asc" } },
    },
  });
}

module.exports = {
  listCountries,
  getBodiesByCountryCode,
  getDocTypesByBodyId,
  getBodyById,
};
