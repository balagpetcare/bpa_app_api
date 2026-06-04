/**
 * Enterprise pricing keys for org owners (aligned with ORG_ADMIN seed + governance).
 * Used by legacy OWNER resolution in `utils/permissions.js` and by unit tests (no Prisma).
 */
const OWNER_ENTERPRISE_PRICING_PERMS = [
  "pricing.central.read",
  "pricing.central.write",
  "pricing.branch.override",
  "pricing.audit.view",
  "pricing.retail.rule.manage",
  "retail.discount.apply",
  "retail.discount.approve",
  "pricing.campaign.manage",
  "pricing.membership.manage",
  "pricing.branch.override.request",
  "pricing.branch.override.approve",
  "pricing.approval.matrix.manage",
  "pricing.emergency.override",
  "pricing.analytics.view",
  "pricing.bulk.import",
];

module.exports = { OWNER_ENTERPRISE_PRICING_PERMS };
