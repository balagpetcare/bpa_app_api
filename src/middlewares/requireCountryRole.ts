/**
 * Require a country-scoped role for the current country context.
 */
const { sendPolicyDenied } = require("../api/v1/utils/policyResponses");

async function requireCountryRole(req, res, next) {
  try {
    const userId = req.user?.id;
    const countryId = req.countryContext?.countryId;
    if (!userId || !countryId) {
      return sendPolicyDenied(res, "NO_COUNTRY_CONTEXT", "Country context required");
    }

    const prisma = req.prisma;
    const exists = await prisma.userCountryRole.findFirst({
      where: { userId: Number(userId), countryId: Number(countryId) },
      select: { userId: true },
    });

    if (!exists) {
      return sendPolicyDenied(res, "COUNTRY_ROLE_REQUIRED", "Country role required");
    }

    return next();
  } catch (e) {
    return next(e);
  }
}

module.exports = requireCountryRole;
export { requireCountryRole };

