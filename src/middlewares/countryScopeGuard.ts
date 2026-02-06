/**
 * Phase 1: Country scope guard for org/branch resources.
 * If request references orgId/branchId, ensure it matches req.countryContext.
 */
const { sendPolicyDenied } = require("../api/v1/utils/policyResponses");

function toId(value: any): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function resolveIdFrom(req: any, keys: string[]): number | null {
  for (const key of keys) {
    const fromParams = req.params?.[key];
    const fromBody = req.body?.[key];
    const fromQuery = req.query?.[key];
    const id = toId(fromParams ?? fromBody ?? fromQuery);
    if (id) return id;
  }
  return null;
}

async function resolveCountryId(prisma: any, countryCode: string | undefined): Promise<number | null> {
  const code = String(countryCode || "").toUpperCase().trim();
  if (!code) return null;
  const row = await prisma.country.findUnique({ where: { code }, select: { id: true } });
  return row?.id ?? null;
}

async function countryScopeGuard(req: any, res: any, next: (err?: any) => void) {
  try {
    const prisma = req.prisma;
    const ctx = req.countryContext;
    if (!prisma || !ctx) return next();

    const orgId = resolveIdFrom(req, ["orgId", "organizationId"]);
    const branchId = resolveIdFrom(req, ["branchId"]);

    if (!orgId && !branchId) return next();

    const expectedCountryId =
      ctx.countryId ?? (await resolveCountryId(prisma, ctx.countryCode));
    if (!expectedCountryId) {
      return sendPolicyDenied(res, "NO_COUNTRY_CONTEXT", "Country context not available");
    }

    let actualCountryId: number | null = null;

    if (branchId) {
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        include: { org: { select: { countryId: true } } },
      });
      if (!branch) return res.status(404).json({ success: false, message: "Branch not found" });
      actualCountryId = branch.org?.countryId ?? null;
    } else if (orgId) {
      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { countryId: true },
      });
      if (!org) return res.status(404).json({ success: false, message: "Organization not found" });
      actualCountryId = org.countryId ?? null;
    }

    if (!actualCountryId) {
      return sendPolicyDenied(res, "COUNTRY_UNBOUND", "Organization is missing country binding");
    }

    if (actualCountryId !== expectedCountryId) {
      return sendPolicyDenied(res, "COUNTRY_SCOPE_MISMATCH", "Country mismatch for requested resource");
    }

    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = countryScopeGuard;
export { countryScopeGuard };

