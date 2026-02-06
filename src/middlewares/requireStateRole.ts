/**
 * Require a state-scoped role for the current state context.
 */
const { sendPolicyDenied } = require("../api/v1/utils/policyResponses");

async function requireStateRole(req, res, next) {
  try {
    const userId = req.user?.id;
    const stateId = req.countryContext?.state?.stateId;
    if (!userId || !stateId) {
      return sendPolicyDenied(res, "NO_STATE_CONTEXT", "State context required");
    }

    const prisma = req.prisma;
    const exists = await prisma.userStateRole.findFirst({
      where: { userId: Number(userId), stateId: Number(stateId) },
      select: { userId: true },
    });

    if (!exists) {
      return sendPolicyDenied(res, "STATE_ROLE_REQUIRED", "State role required");
    }

    return next();
  } catch (e) {
    return next(e);
  }
}

module.exports = requireStateRole;
export { requireStateRole };

