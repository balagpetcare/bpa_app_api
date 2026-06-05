/**
 * Server-side domain registry (mirrors packages/bpa-seo/src/shared/seo/domains.ts).
 * Used for CORS hints, redirect URLs, and documentation references.
 */

export const BPA_DOMAINS = {
  BPA_APEX: "bangladeshpetassociation.com",
  VACCINATION: "vaccination.bangladeshpetassociation.com",
  COMMUNITY_PETS_CLINIC: "communitypetsclinic.com",
  COMMUNITY_PET_SHOP: "communitypetshop.com",
  PET_SMART_SOLUTION: "petsmartsolution.com",
  PRANI_DOCTOR: "pranidoctor.com",
} as const;

export type BpaDomainKey = keyof typeof BPA_DOMAINS;

export const BPA_DOMAIN_ORIGINS: Record<BpaDomainKey, string> = {
  BPA_APEX: `https://${BPA_DOMAINS.BPA_APEX}`,
  VACCINATION: `https://${BPA_DOMAINS.VACCINATION}`,
  COMMUNITY_PETS_CLINIC: `https://${BPA_DOMAINS.COMMUNITY_PETS_CLINIC}`,
  COMMUNITY_PET_SHOP: `https://${BPA_DOMAINS.COMMUNITY_PET_SHOP}`,
  PET_SMART_SOLUTION: `https://${BPA_DOMAINS.PET_SMART_SOLUTION}`,
  PRANI_DOCTOR: `https://${BPA_DOMAINS.PRANI_DOCTOR}`,
};
