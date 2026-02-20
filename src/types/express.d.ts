import "express";
import type { PrismaClient } from "@prisma/client";

/** Global-Ready Phase 1: active policy result from policyEngine.service */
export type CountryContextPolicy = {
  id: number;
  countryId: number;
  name: string;
  status: string;
  country: { code: string; name: string; currencyCode: string | null };
  features: { featureCode: string; enabled: boolean }[];
  donationRules: { ruleType: string; enabled: boolean; maxAmountSingle: string | null; maxAmountDaily: string | null }[];
  rules?: { ruleKey: string; enabled: boolean; valueJson: Record<string, unknown> | null }[];
} | null;

declare global {
  namespace Express {
    interface Request {
      prisma: PrismaClient; // ✅ add this
      user?: {
        id: number;
        role?: string;
        permissions?: string[];
      };
      /** Global-Ready Phase 1: country from header → user → org → default BD */
      countryContext?: {
        countryCode: string;
        countryId: number | null;
        policy: CountryContextPolicy;
        state?: {
          stateCode: string | null;
          stateId: number;
          policyId: number;
        } | null;
      };
    }
  }
}
