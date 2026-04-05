-- Phase 4: POS pricing governance enforcement — additive columns and FKs (non-destructive)

ALTER TABLE "org_pricing_policies" ADD COLUMN IF NOT EXISTS "posPricingGovernanceEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "retail_discount_approval_requests" ADD COLUMN IF NOT EXISTS "consumedOrderId" INTEGER;
ALTER TABLE "retail_discount_approval_requests" ADD COLUMN IF NOT EXISTS "consumedAt" TIMESTAMP(3);

ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "retailDiscountApprovalRequestId" INTEGER;

ALTER TABLE "retail_discount_approval_requests"
  ADD CONSTRAINT "retail_discount_approval_requests_consumedOrderId_fkey"
  FOREIGN KEY ("consumedOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_retailDiscountApprovalRequestId_fkey"
  FOREIGN KEY ("retailDiscountApprovalRequestId") REFERENCES "retail_discount_approval_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "order_items_retailDiscountApprovalRequestId_key" ON "order_items"("retailDiscountApprovalRequestId");

CREATE INDEX IF NOT EXISTS "retail_discount_approval_requests_consumedOrderId_idx" ON "retail_discount_approval_requests"("consumedOrderId");
