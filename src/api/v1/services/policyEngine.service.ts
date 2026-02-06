/**
 * Global-Ready Phase 1: Policy Engine
 * getActivePolicy(countryCode) with Redis cache key policy:{code}:active
 * Reference: docs/GLOBAL_READY_FULL_PLANNING.md
 */

const redis = require("../../../utils/redis");

const CACHE_KEY_PREFIX = "policy:";
const CACHE_KEY_SUFFIX = ":active";
const CACHE_TTL_SEC = Number(process.env.POLICY_CACHE_TTL_SEC) || 300; // 5 min default

export type PaymentMethodResult = {
  providerCode: string;
  enabled: boolean;
  sortOrder: number;
  configJson: Record<string, unknown> | null;
};

export type ActiveStatePolicyResult = {
  id: number;
  stateId: number;
  name: string;
  status: string;
  state: { code: string; name: string; countryId: number };
  features: { featureCode: string; enabled: boolean }[];
  rules?: { ruleKey: string; enabled: boolean; valueJson: Record<string, unknown> | null }[];
} | null;

export type ActivePolicyResult = {
  id: number;
  countryId: number;
  name: string;
  status: string;
  country: { code: string; name: string; currencyCode: string | null };
  features: { featureCode: string; enabled: boolean }[];
  donationRules: { ruleType: string; enabled: boolean; maxAmountSingle: string | null; maxAmountDaily: string | null }[];
  rules?: { ruleKey: string; enabled: boolean; valueJson: Record<string, unknown> | null }[];
  paymentMethods?: PaymentMethodResult[];
} | null;

/**
 * Get active policy for a country. Uses Redis cache key policy:{countryCode}:active.
 * @param prisma - PrismaClient instance
 * @param countryCode - ISO 3166-1 alpha-2 (e.g. BD, IN, US)
 */
export async function getActivePolicy(
  prisma: { countryPolicy: { findFirst: (arg: any) => Promise<any> } },
  countryCode: string
): Promise<ActivePolicyResult> {
  const code = String(countryCode || "").toUpperCase().trim() || "BD";
  const cacheKey = `${CACHE_KEY_PREFIX}${code}${CACHE_KEY_SUFFIX}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as ActivePolicyResult;
    }
  } catch (_) {
    // Redis miss or error: fall through to DB
  }

  const policy = await prisma.countryPolicy.findFirst({
    where: {
      status: "ACTIVE",
      country: { code, isActive: true },
    },
    orderBy: { effectiveFrom: "desc" },
    include: {
      country: { select: { code: true, name: true, currencyCode: true } },
      features: { select: { featureCode: true, enabled: true } },
      donationRules: { select: { ruleType: true, enabled: true, maxAmountSingle: true, maxAmountDaily: true } },
      rules: { select: { ruleKey: true, enabled: true, valueJson: true } },
      paymentMethods: { where: { enabled: true }, orderBy: { sortOrder: "asc" }, select: { providerCode: true, enabled: true, sortOrder: true, configJson: true } },
    },
  });

  if (!policy) {
    return null;
  }

  const result: ActivePolicyResult = {
    id: policy.id,
    countryId: policy.countryId,
    name: policy.name,
    status: policy.status,
    country: {
      code: policy.country.code,
      name: policy.country.name,
      currencyCode: policy.country.currencyCode,
    },
    features: policy.features.map((f) => ({ featureCode: f.featureCode, enabled: f.enabled })),
    donationRules: policy.donationRules.map((r) => ({
      ruleType: r.ruleType,
      enabled: r.enabled,
      maxAmountSingle: r.maxAmountSingle != null ? String(r.maxAmountSingle) : null,
      maxAmountDaily: r.maxAmountDaily != null ? String(r.maxAmountDaily) : null,
    })),
    rules: (policy.rules || []).map((r) => ({
      ruleKey: r.ruleKey,
      enabled: r.enabled,
      valueJson: (r.valueJson as Record<string, unknown>) || null,
    })),
    paymentMethods: (policy.paymentMethods || []).map((p) => ({
      providerCode: p.providerCode,
      enabled: p.enabled,
      sortOrder: p.sortOrder,
      configJson: p.configJson as Record<string, unknown> | null,
    })),
  };

  try {
    await redis.set(cacheKey, JSON.stringify(result), "EX", CACHE_TTL_SEC);
  } catch (_) {
    // ignore cache set errors
  }

  return result;
}

/**
 * Get enabled payment methods for a country (from active policy).
 */
export async function getPaymentMethods(
  prisma: { countryPolicy: { findFirst: (arg: any) => Promise<any> } },
  countryCode: string
): Promise<PaymentMethodResult[]> {
  const policy = await getActivePolicy(prisma, countryCode);
  return (policy?.paymentMethods || []).filter((p) => p.enabled);
}

/**
 * Get active state policy for a state code (within a country).
 */
export async function getActiveStatePolicy(
  prisma: { state: { findFirst: (arg: any) => Promise<any> } },
  countryCode: string,
  stateCode: string
): Promise<ActiveStatePolicyResult> {
  const cCode = String(countryCode || "").toUpperCase().trim();
  const sCode = String(stateCode || "").toUpperCase().trim();
  if (!cCode || !sCode) return null;

  const state = await prisma.state.findFirst({
    where: { code: sCode, isActive: true, country: { code: cCode, isActive: true } },
    include: {
      policies: {
        where: { status: "ACTIVE" },
        orderBy: { effectiveFrom: "desc" },
        take: 1,
        include: {
          features: { select: { featureCode: true, enabled: true } },
          rules: { select: { ruleKey: true, enabled: true, valueJson: true } },
        },
      },
    },
  });

  const policy = state?.policies?.[0];
  if (!state || !policy) return null;

  return {
    id: policy.id,
    stateId: state.id,
    name: policy.name,
    status: policy.status,
    state: { code: state.code, name: state.name, countryId: state.countryId },
    features: policy.features.map((f) => ({ featureCode: f.featureCode, enabled: f.enabled })),
    rules: (policy.rules || []).map((r) => ({
      ruleKey: r.ruleKey,
      enabled: r.enabled,
      valueJson: (r.valueJson as Record<string, unknown>) || null,
    })),
  };
}

/**
 * Invalidate cached policy for a country (e.g. after admin updates policy).
 */
export async function invalidatePolicyCache(countryCode: string): Promise<void> {
  const code = String(countryCode || "").toUpperCase().trim();
  if (!code) return;
  const cacheKey = `${CACHE_KEY_PREFIX}${code}${CACHE_KEY_SUFFIX}`;
  try {
    await redis.del(cacheKey);
  } catch (_) {
    // ignore
  }
}
