-- Wave-4 hardening: cover CTS detail / cost-fact drill-down by org + variant + branch + period window
CREATE INDEX IF NOT EXISTS "cost_facts_orgId_variantId_branchId_periodStart_periodEnd_idx"
  ON "cost_facts" ("orgId", "variantId", "branchId", "periodStart", "periodEnd");
