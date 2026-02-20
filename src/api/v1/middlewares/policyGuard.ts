/**
 * Phase 4: Generic policy guard (rules as data).
 * Usage: policyGuard("donation.max_per_tx", { valueGetter: (req) => req.body.amount })
 */
const { sendPolicyDenied } = require("../utils/policyResponses");

type PolicyGuardOptions = {
  valueGetter?: (req: any) => unknown;
  message?: string;
};

function parseNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function evaluateRule(rule, value) {
  if (!rule || rule.enabled === false) {
    return { allowed: false, reasonCode: "RULE_DISABLED" };
  }

  const cfg = rule.valueJson || {};
  if (cfg.allowed === false) {
    return { allowed: false, reasonCode: "RULE_DISABLED" };
  }

  const val = parseNumber(value);
  if (val == null) return { allowed: true };

  const max = parseNumber(cfg.maxAmount);
  if (max != null && val > max) {
    return { allowed: false, reasonCode: "LIMIT_EXCEEDED", details: { limit: max, value: val } };
  }

  const min = parseNumber(cfg.minAmount);
  if (min != null && val < min) {
    return { allowed: false, reasonCode: "LIMIT_BELOW_MIN", details: { limit: min, value: val } };
  }

  return { allowed: true };
}

function policyGuard(ruleKey: string, options: PolicyGuardOptions = {}) {
  const key = String(ruleKey || "").trim();
  const valueGetter = options.valueGetter;
  const denyMessage = options.message || "Policy rule denied";
  return (req, res, next) => {
    const ctx = req.countryContext;
    if (!ctx || !ctx.policy) {
      return sendPolicyDenied(res, "NO_POLICY", "No active policy for this country");
    }

    const rule = (ctx.policy.rules || []).find((r) => r.ruleKey === key);
    if (!rule) return next(); // allow by default if rule not defined

    const value = typeof valueGetter === "function" ? valueGetter(req) : null;
    const result = evaluateRule(rule, value);
    if (!result.allowed) {
      return sendPolicyDenied(res, result.reasonCode || "RULE_DENIED", denyMessage, result.details);
    }
    return next();
  };
}

module.exports = { policyGuard };
export { policyGuard };

