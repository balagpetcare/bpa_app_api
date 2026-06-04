-- POS enterprise: carts, cart lines, split order payments, MIXED payment method
-- Non-destructive: additive enums/tables only.

CREATE TYPE "PosCartStatus" AS ENUM ('ACTIVE', 'HELD', 'CHECKOUT', 'PAID', 'ABANDONED');

CREATE TYPE "OrderPaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'MIXED';

CREATE TABLE "pos_carts" (
    "id" SERIAL NOT NULL,
    "cartNumber" TEXT NOT NULL,
    "branchId" INTEGER NOT NULL,
    "staffUserId" INTEGER NOT NULL,
    "posShiftId" INTEGER,
    "status" "PosCartStatus" NOT NULL DEFAULT 'ACTIVE',
    "customerUserId" INTEGER,
    "ownerDiscountCardId" INTEGER,
    "memberNameSnapshot" VARCHAR(256),
    "cardNumberSnapshot" VARCHAR(32),
    "discountPercentSnapshot" DECIMAL(5,2),
    "metadataJson" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_carts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pos_carts_cartNumber_key" ON "pos_carts"("cartNumber");

CREATE INDEX "pos_carts_branch_staff_status_idx" ON "pos_carts"("branchId", "staffUserId", "status");

CREATE INDEX "pos_carts_branchId_idx" ON "pos_carts"("branchId");

CREATE INDEX "pos_carts_posShiftId_idx" ON "pos_carts"("posShiftId");

ALTER TABLE "pos_carts" ADD CONSTRAINT "pos_carts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pos_carts" ADD CONSTRAINT "pos_carts_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pos_carts" ADD CONSTRAINT "pos_carts_posShiftId_fkey" FOREIGN KEY ("posShiftId") REFERENCES "pos_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pos_carts" ADD CONSTRAINT "pos_carts_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pos_carts" ADD CONSTRAINT "pos_carts_ownerDiscountCardId_fkey" FOREIGN KEY ("ownerDiscountCardId") REFERENCES "owner_discount_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "pos_cart_lines" (
    "id" SERIAL NOT NULL,
    "cartId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "variantId" INTEGER,
    "quantity" INTEGER NOT NULL,
    "unitListPrice" DECIMAL(12,2) NOT NULL,
    "unitSellPrice" DECIMAL(12,2) NOT NULL,
    "retailDiscountApprovalId" INTEGER,
    "pricingSnapshotJson" JSONB,
    "mergedKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_cart_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pos_cart_lines_cartId_idx" ON "pos_cart_lines"("cartId");

CREATE INDEX "pos_cart_lines_variantId_idx" ON "pos_cart_lines"("variantId");

ALTER TABLE "pos_cart_lines" ADD CONSTRAINT "pos_cart_lines_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "pos_carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pos_cart_lines" ADD CONSTRAINT "pos_cart_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pos_cart_lines" ADD CONSTRAINT "pos_cart_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "order_payments" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" VARCHAR(128),
    "paymentStatus" "OrderPaymentStatus" NOT NULL DEFAULT 'PAID',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_payments_orderId_idx" ON "order_payments"("orderId");

CREATE INDEX "order_payments_method_idx" ON "order_payments"("method");

ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
