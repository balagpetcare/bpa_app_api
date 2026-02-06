/**
 * Global-Ready Phase 1: Country context middleware
 * Resolve country: header (X-Country-Code) → user → org → default BD.
 * Sets req.countryContext = { countryCode, policy }.
 * Reference: docs/GLOBAL_READY_FULL_PLANNING.md
 */

const { getActivePolicy, getActiveStatePolicy } = require("../api/v1/services/policyEngine.service");

const DEFAULT_COUNTRY = process.env.COUNTRY_DEFAULT || "BD";
const HEADER_COUNTRY = "x-country-code";
const HEADER_STATE = "x-state-code";

function normalizeCountryCode(value: string | undefined): string {
  const v = String(value || "").toUpperCase().trim().slice(0, 2);
  return v || DEFAULT_COUNTRY;
}

async function resolveCountryContext(req: any, prisma: any): Promise<{
  countryCode: string;
  countryId: number | null;
}> {
  const headerCode = req.headers[HEADER_COUNTRY];
  if (headerCode) {
    return { countryCode: normalizeCountryCode(headerCode), countryId: null };
  }

  const userId = Number(req.user?.id || 0);
  if (Number.isFinite(userId) && userId > 0 && prisma) {
    const userCountry = await prisma.userCountryRole.findFirst({
      where: { userId },
      include: { country: { select: { id: true, code: true } } },
    });
    if (userCountry?.country?.code) {
      return { countryCode: userCountry.country.code, countryId: userCountry.country.id };
    }

    const orgMember = await prisma.orgMember.findFirst({
      where: { userId, status: "ACTIVE" },
      include: { org: { select: { countryId: true } } },
    });
    let countryId = orgMember?.org?.countryId ?? null;

    if (!countryId) {
      const ownedOrg = await prisma.organization.findFirst({
        where: { ownerUserId: userId },
        select: { countryId: true },
      });
      countryId = ownedOrg?.countryId ?? null;
    }

    if (countryId) {
      const country = await prisma.country.findUnique({
        where: { id: countryId },
        select: { code: true },
      });
      if (country?.code) {
        return { countryCode: country.code, countryId };
      }
    }
  }

  return { countryCode: DEFAULT_COUNTRY, countryId: null };
}

/**
 * Middleware: attach req.countryContext = { countryCode, policy }.
 * Order: header → user country role → org country → default BD.
 */
async function countryContextMiddleware(req: any, _res: any, next: (err?: any) => void) {
  try {
    const prisma = req.prisma;
    const resolved = await resolveCountryContext(req, prisma);
    const policy = prisma ? await getActivePolicy(prisma, resolved.countryCode) : null;

    // Phase 5: optional state override (X-State-Code)
    const stateCodeRaw = req.headers[HEADER_STATE];
    const stateCode = stateCodeRaw ? String(stateCodeRaw).toUpperCase().trim() : null;
    let statePolicy = null;
    if (prisma && stateCode) {
      statePolicy = await getActiveStatePolicy(prisma, resolved.countryCode, stateCode);
    }

    let mergedPolicy = policy;
    if (policy && statePolicy) {
      const featureMap = new Map((policy.features || []).map((f: any) => [f.featureCode, f]));
      (statePolicy.features || []).forEach((f: any) => featureMap.set(f.featureCode, f));
      const rulesMap = new Map((policy.rules || []).map((r: any) => [r.ruleKey, r]));
      (statePolicy.rules || []).forEach((r: any) => rulesMap.set(r.ruleKey, r));
      mergedPolicy = {
        ...policy,
        features: Array.from(featureMap.values()),
        rules: Array.from(rulesMap.values()),
      };
    }

    req.countryContext = {
      countryCode: resolved.countryCode,
      countryId: policy?.countryId ?? resolved.countryId ?? null,
      policy: mergedPolicy,
      state: statePolicy
        ? {
            stateCode,
            stateId: statePolicy.stateId,
            policyId: statePolicy.id,
          }
        : null,
    };
    next();
  } catch (err: any) {
    req.countryContext = { countryCode: DEFAULT_COUNTRY, countryId: null, policy: null, state: null };
    next(err);
  }
}

module.exports = countryContextMiddleware;
export { countryContextMiddleware };
