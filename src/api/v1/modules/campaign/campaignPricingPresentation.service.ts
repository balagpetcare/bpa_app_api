/**
 * Resolves public campaign pricing breakdown and package feature lines.
 */

import type { Campaign, CampaignIncludedVaccine } from "@prisma/client";
import { mapIncludedVaccineRow, type CampaignIncludedVaccineDto } from "./campaignIncludedVaccine.service";

export type CampaignPricingDto = {
  vaccineCost: number;
  serviceCharge: number;
  totalPrice: number;
  currency: string;
  packageFeatures: string[];
  isFree: boolean;
};

function toMoney(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parsePackageFeatures(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((s) => s.length > 0);
}

function readPricingFromMetadata(metadataJson: unknown): {
  vaccineCost?: number;
  serviceCharge?: number;
} {
  if (!metadataJson || typeof metadataJson !== "object") return {};
  const root = metadataJson as Record<string, unknown>;
  const pricing = root.pricing;
  if (!pricing || typeof pricing !== "object") return {};
  const p = pricing as Record<string, unknown>;
  return {
    vaccineCost: toMoney(p.vaccineCost) ?? undefined,
    serviceCharge: toMoney(p.serviceCharge) ?? undefined,
  };
}

/** Resolve per-cat costs for API display — never maps full total to vaccine with zero service unless DB says so. */
export function resolveCampaignPricing(
  campaign: Pick<
    Campaign,
    | "pricingType"
    | "priceAmount"
    | "vaccineCost"
    | "serviceCharge"
    | "currency"
    | "packageFeatures"
    | "metadataJson"
  >
): CampaignPricingDto {
  const currency = campaign.currency || "BDT";
  const isFree = campaign.pricingType === "FREE";

  if (isFree) {
    return {
      vaccineCost: 0,
      serviceCharge: 0,
      totalPrice: 0,
      currency,
      packageFeatures: parsePackageFeatures(campaign.packageFeatures),
      isFree: true,
    };
  }

  const meta = readPricingFromMetadata(campaign.metadataJson);
  const totalFromDb = toMoney(campaign.priceAmount);

  let vaccineCost =
    toMoney(campaign.vaccineCost) ?? meta.vaccineCost ?? null;
  let serviceCharge =
    toMoney(campaign.serviceCharge) ?? meta.serviceCharge ?? null;

  if (vaccineCost != null && serviceCharge != null) {
    const totalPrice = vaccineCost + serviceCharge;
    return {
      vaccineCost,
      serviceCharge,
      totalPrice,
      currency,
      packageFeatures: parsePackageFeatures(campaign.packageFeatures),
      isFree: false,
    };
  }

  if (vaccineCost != null && serviceCharge == null && totalFromDb != null) {
    serviceCharge = Math.max(0, totalFromDb - vaccineCost);
    return {
      vaccineCost,
      serviceCharge,
      totalPrice: vaccineCost + serviceCharge,
      currency,
      packageFeatures: parsePackageFeatures(campaign.packageFeatures),
      isFree: false,
    };
  }

  if (serviceCharge != null && vaccineCost == null && totalFromDb != null) {
    vaccineCost = Math.max(0, totalFromDb - serviceCharge);
    return {
      vaccineCost,
      serviceCharge,
      totalPrice: vaccineCost + serviceCharge,
      currency,
      packageFeatures: parsePackageFeatures(campaign.packageFeatures),
      isFree: false,
    };
  }

  if (totalFromDb != null && totalFromDb > 0) {
    return {
      vaccineCost: 0,
      serviceCharge: 0,
      totalPrice: totalFromDb,
      currency,
      packageFeatures: parsePackageFeatures(campaign.packageFeatures),
      isFree: false,
    };
  }

  return {
    vaccineCost: 0,
    serviceCharge: 0,
    totalPrice: 0,
    currency,
    packageFeatures: parsePackageFeatures(campaign.packageFeatures),
    isFree: false,
  };
}

/** True when vaccine + service are configured and sum to total. */
export function hasPricingBreakdown(pricing: CampaignPricingDto): boolean {
  return (
    !pricing.isFree &&
    pricing.totalPrice > 0 &&
    pricing.vaccineCost + pricing.serviceCharge === pricing.totalPrice &&
    (pricing.vaccineCost > 0 || pricing.serviceCharge > 0)
  );
}

export function normalizeCampaignPricingFields(input: {
  pricingType?: string;
  priceAmount?: number | null;
  vaccineCost?: number | null;
  serviceCharge?: number | null;
  packageFeatures?: string[] | null;
}): {
  priceAmount?: number | null;
  vaccineCost?: number | null;
  serviceCharge?: number | null;
  packageFeatures?: string[];
} {
  const isFree = input.pricingType === "FREE";
  if (isFree) {
    return {
      priceAmount: 0,
      vaccineCost: 0,
      serviceCharge: 0,
      packageFeatures: input.packageFeatures ?? [],
    };
  }

  const vaccineCost =
    input.vaccineCost != null ? toMoney(input.vaccineCost) : null;
  const serviceCharge =
    input.serviceCharge != null ? toMoney(input.serviceCharge) : null;

  if (vaccineCost != null && serviceCharge != null) {
    return {
      priceAmount: vaccineCost + serviceCharge,
      vaccineCost,
      serviceCharge,
      packageFeatures: input.packageFeatures ?? undefined,
    };
  }

  const total = input.priceAmount != null ? toMoney(input.priceAmount) : null;
  if (vaccineCost != null && total != null) {
    return {
      priceAmount: total,
      vaccineCost,
      serviceCharge: Math.max(0, total - vaccineCost),
      packageFeatures: input.packageFeatures ?? undefined,
    };
  }
  if (serviceCharge != null && total != null) {
    return {
      priceAmount: total,
      vaccineCost: Math.max(0, total - serviceCharge),
      serviceCharge,
      packageFeatures: input.packageFeatures ?? undefined,
    };
  }

  return {
    priceAmount: total ?? 0,
    vaccineCost: vaccineCost ?? undefined,
    serviceCharge: serviceCharge ?? undefined,
    packageFeatures: input.packageFeatures ?? undefined,
  };
}

function formatVaccineFeatureLabel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  if (/\bvaccine\b/i.test(trimmed)) return trimmed;
  return `${trimmed} Vaccine`;
}

/** Checklist lines: vaccines (with Vaccine suffix) then package features. */
export function buildPackageFeatureLines(
  includedVaccines: CampaignIncludedVaccineDto[],
  pricing: CampaignPricingDto
): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const v of includedVaccines) {
    const label = formatVaccineFeatureLabel(v.name);
    const key = label.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      lines.push(label);
    }
  }
  for (const feature of pricing.packageFeatures) {
    const key = feature.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      lines.push(feature);
    }
  }
  return lines;
}

export function serializePublicCampaignPricing<
  T extends Campaign & { includedVaccines?: CampaignIncludedVaccine[] },
>(campaign: T) {
  const includedVaccines = (campaign.includedVaccines ?? []).map(mapIncludedVaccineRow);
  const pricing = resolveCampaignPricing(campaign);
  const packageFeatureLines = buildPackageFeatureLines(includedVaccines, pricing);
  const { includedVaccines: _rows, packageFeatures: _pf, ...rest } = campaign;

  return {
    ...rest,
    priceAmount: pricing.totalPrice,
    vaccineCost: pricing.vaccineCost,
    serviceCharge: pricing.serviceCharge,
    includedVaccines,
    pricing: {
      ...pricing,
      packageFeatureLines,
    },
  };
}
