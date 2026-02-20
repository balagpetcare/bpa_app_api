/**
 * Global-Ready Phase 2: Feature gate middleware
 * requireFeature('DONATION') from policy; 403 POLICY_DENIED if disabled
 * Reference: docs/GLOBAL_READY_FULL_PLANNING.md
 */

const { sendPolicyDenied } = require("../utils/policyResponses");

/**
 * Middleware factory: require that the given feature is enabled in req.countryContext.policy.
 * Must run after countryContext middleware.
 * On failure: 403 POLICY_DENIED, reason_code FEATURE_DISABLED
 */
function requireFeature(featureCode: string) {
  return (req: any, res: any, next: (err?: any) => void) => {
    const ctx = req.countryContext;
    if (!ctx) {
      return sendPolicyDenied(res, "NO_COUNTRY_CONTEXT", "Country context not available");
    }
    const policy = ctx.policy;
    if (!policy) {
      return sendPolicyDenied(res, "NO_POLICY", "No active policy for this country");
    }
    const feature = (policy.features || []).find(
      (f: { featureCode: string }) => f.featureCode === featureCode
    );
    if (!feature || !feature.enabled) {
      return sendPolicyDenied(res, "FEATURE_DISABLED", `${featureCode} is not enabled in this region`);
    }
    next();
  };
}

module.exports = { requireFeature };
export { requireFeature };
